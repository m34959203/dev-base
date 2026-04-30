import cron from "node-cron";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Prisma, ScheduledJob } from "@prisma/client";
import { publishArticle, retryPublication, type PublishablePlatform } from "./social/publisher";
import { dispatchCrmEvent, type CrmEventType } from "./crm";

/**
 * Durable job scheduler — state lives in the `ScheduledJob` table.
 *
 * Strategy:
 *  - A single cron tick every 60s inside the Next.js server process (via
 *    instrumentation.ts).
 *  - Each tick scans PENDING jobs with runAt <= now, claims them atomically
 *    with an updateMany condition (DB-level CAS), and runs handlers.
 *  - Failed jobs are rescheduled with exponential backoff until 5 attempts.
 *  - The /api/cron/tick endpoint can be called externally (e.g. GitHub Actions,
 *    a Kubernetes CronJob, Vercel Cron) as a fallback if the in-process cron
 *    is unreliable.
 */

const MAX_ATTEMPTS = 5;
const LOCK_BATCH_SIZE = 10;

let cronStarted = false;
let tickRunning = false;

type PublishArticlePayload = {
  articleId: string;
  platforms: PublishablePlatform[];
  language?: "kk" | "ru";
};

type RetryPublicationPayload = {
  publicationId: string;
};

type SendCrmWebhookPayload = {
  event: CrmEventType;
  payload: Record<string, unknown>;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parsePublishArticle(p: Prisma.JsonValue): PublishArticlePayload {
  if (!isRecord(p)) throw new Error("invalid publishArticle payload");
  const articleId = p.articleId;
  const platforms = p.platforms;
  if (typeof articleId !== "string") throw new Error("articleId required");
  if (!Array.isArray(platforms)) throw new Error("platforms array required");
  const plats = platforms.filter(
    (x): x is PublishablePlatform => x === "TELEGRAM" || x === "INSTAGRAM",
  );
  const language = p.language === "kk" || p.language === "ru" ? p.language : undefined;
  return { articleId, platforms: plats, language };
}

function parseRetryPublication(p: Prisma.JsonValue): RetryPublicationPayload {
  if (!isRecord(p) || typeof p.publicationId !== "string") {
    throw new Error("invalid retryPublication payload");
  }
  return { publicationId: p.publicationId };
}

function parseSendCrmWebhook(p: Prisma.JsonValue): SendCrmWebhookPayload {
  if (!isRecord(p)) throw new Error("invalid sendCrmWebhook payload");
  const event = p.event;
  const payload = p.payload;
  if (typeof event !== "string") throw new Error("event required");
  if (!isRecord(payload)) throw new Error("payload required");
  return { event: event as CrmEventType, payload };
}

async function claimJob(job: ScheduledJob): Promise<boolean> {
  // CAS: only transition PENDING → RUNNING once.
  const res = await prisma.scheduledJob.updateMany({
    where: { id: job.id, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  return res.count === 1;
}

function backoffDelayMs(attempt: number): number {
  // attempt = failed attempts count. 1→60s, 2→4m, 3→15m, 4→1h, 5→4h
  const base = 60_000;
  return base * 4 ** (attempt - 1);
}

async function runJob(job: ScheduledJob): Promise<void> {
  try {
    switch (job.type) {
      case "PUBLISH_ARTICLE": {
        const { articleId, platforms, language } = parsePublishArticle(job.payload);
        await publishArticle(articleId, platforms, language);
        break;
      }
      case "RETRY_PUBLICATION": {
        const { publicationId } = parseRetryPublication(job.payload);
        await retryPublication(publicationId);
        break;
      }
      case "SEND_CRM_WEBHOOK": {
        const { event, payload } = parseSendCrmWebhook(job.payload);
        if (event === "growth.post") {
          const { postGrowthContentToTelegram } = await import("./growth-post");
          const p = payload as {
            growthActionId: string;
            platform: string;
            content: string;
            title?: string;
          };
          await postGrowthContentToTelegram(p);
        } else {
          await dispatchCrmEvent(event, payload);
        }
        break;
      }
      default:
        throw new Error(`Unknown job type: ${job.type as string}`);
    }
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        completedAt: new Date(),
        attempts: { increment: 1 },
        error: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          attempts,
          error: message,
        },
      });
    } else {
      // Retry: reset to PENDING with later runAt
      const nextRun = new Date(Date.now() + backoffDelayMs(attempts));
      await prisma.scheduledJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          attempts,
          error: message,
          runAt: nextRun,
          startedAt: null,
        },
      });
    }
  }
}

export async function runScheduler(): Promise<{ processed: number; errors: number }> {
  if (tickRunning) return { processed: 0, errors: 0 };
  tickRunning = true;
  let processed = 0;
  let errors = 0;
  try {
    const candidates = await prisma.scheduledJob.findMany({
      where: { status: "PENDING", runAt: { lte: new Date() } },
      orderBy: { runAt: "asc" },
      take: LOCK_BATCH_SIZE,
    });

    for (const job of candidates) {
      const claimed = await claimJob(job);
      if (!claimed) continue;
      try {
        await runJob(job);
        processed += 1;
      } catch {
        errors += 1;
      }
    }
  } finally {
    tickRunning = false;
  }
  return { processed, errors };
}

export function startScheduler(): void {
  if (cronStarted) return;
  if (typeof window !== "undefined") return; // server-only
  cronStarted = true;
  // every minute
  cron.schedule("* * * * *", () => {
    runScheduler().catch((e) => {
      logger.error("scheduler.tick_failed", { err: e });
    });
  });
  logger.info("scheduler.started", { intervalSec: 60 });
}

/**
 * Helper: upsert a ScheduledJob for an article's scheduledAt.
 * Call this from the Sprint 2 Article save handler.
 */
export async function scheduleArticlePublish(
  articleId: string,
  platforms: PublishablePlatform[],
  runAt: Date,
  language?: "kk" | "ru",
): Promise<void> {
  // Remove any previous pending job for this article
  await prisma.scheduledJob.deleteMany({
    where: {
      type: "PUBLISH_ARTICLE",
      status: "PENDING",
      payload: { path: ["articleId"], equals: articleId } as Prisma.JsonFilter,
    },
  });
  await prisma.scheduledJob.create({
    data: {
      type: "PUBLISH_ARTICLE",
      runAt,
      payload: { articleId, platforms, language } as Prisma.InputJsonValue,
    },
  });
}

export async function cancelArticleJobs(articleId: string): Promise<void> {
  await prisma.scheduledJob.deleteMany({
    where: {
      type: "PUBLISH_ARTICLE",
      status: "PENDING",
      payload: { path: ["articleId"], equals: articleId } as Prisma.JsonFilter,
    },
  });
}
