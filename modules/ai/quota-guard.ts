import { prisma } from "@/lib/db";
import { getGcpQuotaUsage } from "@/lib/gcp-monitoring";
import { logger } from "@/lib/logger";

/**
 * Gemini API free tier limits (post-2025-12 reduction).
 * Sourced from https://www.aifreeapi.com/en/posts/gemini-api-rate-limits-per-tier
 * Grounded = combined 1500/day for Flash 2.0 + 2.5.
 */
export const FREE_TIER = {
  "gemini-2.5-flash": { rpm: 10, rpd: 250, tpm: 250_000 },
  "gemini-2.5-pro": { rpm: 5, rpd: 100, tpm: 250_000 },
  "gemini-2.5-flash-lite": { rpm: 15, rpd: 1000, tpm: 250_000 },
  "gemini-2.0-flash": { rpm: 15, rpd: 200, tpm: 1_000_000 },
} as const;

export const TRIAL_CREDIT_USD = 300;

/**
 * Safety buffer — we block at this fraction of the real limit.
 * 0.9 = block when 90% of RPD/RPM/TPM is reached, leaving headroom.
 */
export const SAFETY_RATIO = 0.9;

export class QuotaExceededError extends Error {
  constructor(
    message: string,
    public readonly scope: "rpm" | "rpd" | "tpm",
    public readonly retryAfterSec: number,
  ) {
    super(message);
    this.name = "QuotaExceededError";
  }
}

/**
 * Pre-flight check. Throws QuotaExceededError if this request would exceed
 * safety threshold on any dimension (RPM/RPD/TPM).
 */
// In-process rate limiter (belt-and-suspenders for bursts).
// Reset every 60s. Shared across all models/callers in the Node process.
const rpmBucket: { ts: number[] } = { ts: [] };
// Shortest RPM across all models (safest default)
const SOFT_RPM_CAP = 8;

export async function assertQuota(model: string): Promise<void> {
  const limits = FREE_TIER[model as keyof typeof FREE_TIER];
  if (!limits) return; // unknown model (e.g. OpenRouter) — no enforcement

  const now = new Date();
  const oneMinAgo = new Date(now.getTime() - 60_000);
  const oneDayAgo = new Date(now.getTime() - 24 * 3600_000);

  // --- B) In-process RPM guard: prevents bursts even before DB/GCP see them ---
  const nowMs = now.getTime();
  rpmBucket.ts = rpmBucket.ts.filter((t) => t > nowMs - 60_000);
  if (rpmBucket.ts.length >= SOFT_RPM_CAP) {
    throw new QuotaExceededError(
      `In-process burst guard: ${rpmBucket.ts.length}/${SOFT_RPM_CAP} за последнюю минуту.`,
      "rpm",
      30,
    );
  }

  const recent = await prisma.aIGeneration.findMany({
    where: { provider: "gemini", model, createdAt: { gte: oneDayAgo } },
    select: { createdAt: true, promptTokens: true, completionTokens: true },
  });
  const dbRpm = recent.filter((r) => r.createdAt >= oneMinAgo).length;
  const dbRpd = recent.length;
  const tpm = recent
    .filter((r) => r.createdAt >= oneMinAgo)
    .reduce((a, r) => a + r.promptTokens + r.completionTokens, 0);

  // --- A) Pull REAL usage from Google via Monitoring API (covers "other projects on this key" case) ---
  let gcpRpm = 0;
  let gcpRpd = 0;
  try {
    const gcp = await getGcpQuotaUsage();
    if (gcp.ok) {
      for (const row of gcp.data) {
        // Filter by model if possible; otherwise apply to all Gemini
        if (row.model && row.model !== model) continue;
        if (row.window === "per_minute" && row.usage > gcpRpm) gcpRpm = row.usage;
        if (row.window === "per_day" && row.usage > gcpRpd) gcpRpd = row.usage;
      }
    }
  } catch (err) {
    logger.debug("ai-quota.gcp_read_failed", { err: err instanceof Error ? err.message : String(err) });
  }

  // Take MAX across sources → блокируем по худшей оценке
  const rpm = Math.max(dbRpm, gcpRpm);
  const rpd = Math.max(dbRpd, gcpRpd);

  const safe = (n: number) => Math.floor(n * SAFETY_RATIO);

  // Record this pending call in the in-process bucket (will be filtered out after 60s)
  rpmBucket.ts.push(nowMs);

  if (rpm >= safe(limits.rpm)) {
    const src = gcpRpm > dbRpm ? "GCP" : "DB";
    throw new QuotaExceededError(
      `Достигнут безопасный лимит RPM (${rpm}/${limits.rpm}, источник: ${src}). Попробуйте через минуту.`,
      "rpm",
      60,
    );
  }
  if (rpd >= safe(limits.rpd)) {
    // retry after midnight PT (~00:00 PT = 10:00 MSK next day)
    const ptNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const ptMidnight = new Date(ptNow);
    ptMidnight.setDate(ptMidnight.getDate() + 1);
    ptMidnight.setHours(0, 0, 0, 0);
    const retryAfter = Math.max(60, Math.floor((ptMidnight.getTime() - ptNow.getTime()) / 1000));
    const src = gcpRpd > dbRpd ? "GCP" : "DB";
    throw new QuotaExceededError(
      `Достигнут дневной лимит (${rpd}/${limits.rpd}, источник: ${src}). Сброс в 00:00 по тихоокеанскому времени (~10:00 МСК).`,
      "rpd",
      retryAfter,
    );
  }
  if (tpm >= safe(limits.tpm)) {
    throw new QuotaExceededError(
      `Достигнут безопасный лимит токенов/мин. Попробуйте через минуту.`,
      "tpm",
      60,
    );
  }
}

export type QuotaStatus = "ok" | "warn" | "crit";

export interface QuotaSnapshot {
  model: string;
  limits: { rpm: number; rpd: number; tpm: number };
  current: {
    rpmUsed: number; // last 60s
    rpdUsed: number; // last 24h (by model)
    tpmUsed: number; // last 60s prompt+completion tokens
  };
  pct: { rpm: number; rpd: number; tpm: number };
  worstStatus: QuotaStatus;
}

export interface SpendSnapshot {
  last24hUsd: number;
  last7dUsd: number;
  thisMonthUsd: number;
  thisMonthTokens: number;
  projectedMonthUsd: number;
  budgetUsd: number;
  budgetRemainingUsd: number;
  budgetPctUsed: number;
}

function pctOf(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, (used / limit) * 100);
}

function statusFromPct(pct: number): QuotaStatus {
  if (pct >= 90) return "crit";
  if (pct >= 70) return "warn";
  return "ok";
}

export async function getQuotaSnapshots(): Promise<QuotaSnapshot[]> {
  const now = new Date();
  const oneMinAgo = new Date(now.getTime() - 60_000);
  const oneDayAgo = new Date(now.getTime() - 24 * 3600_000);

  const rows = await prisma.aIGeneration.findMany({
    where: { provider: "gemini", createdAt: { gte: oneDayAgo } },
    select: {
      model: true,
      promptTokens: true,
      completionTokens: true,
      createdAt: true,
    },
  });

  const byModel = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byModel.has(r.model)) byModel.set(r.model, []);
    byModel.get(r.model)!.push(r);
  }

  const snapshots: QuotaSnapshot[] = [];
  for (const [model, items] of byModel.entries()) {
    const limits = FREE_TIER[model as keyof typeof FREE_TIER] ?? { rpm: 10, rpd: 250, tpm: 250_000 };
    const rpmUsed = items.filter((i) => i.createdAt >= oneMinAgo).length;
    const rpdUsed = items.length;
    const tpmUsed = items
      .filter((i) => i.createdAt >= oneMinAgo)
      .reduce((a, i) => a + i.promptTokens + i.completionTokens, 0);

    const pctRpm = pctOf(rpmUsed, limits.rpm);
    const pctRpd = pctOf(rpdUsed, limits.rpd);
    const pctTpm = pctOf(tpmUsed, limits.tpm);
    const worst = Math.max(pctRpm, pctRpd, pctTpm);

    snapshots.push({
      model,
      limits,
      current: { rpmUsed, rpdUsed, tpmUsed },
      pct: { rpm: pctRpm, rpd: pctRpd, tpm: pctTpm },
      worstStatus: statusFromPct(worst),
    });
  }

  if (snapshots.length === 0) {
    const m = "gemini-2.5-flash";
    snapshots.push({
      model: m,
      limits: FREE_TIER[m],
      current: { rpmUsed: 0, rpdUsed: 0, tpmUsed: 0 },
      pct: { rpm: 0, rpd: 0, tpm: 0 },
      worstStatus: "ok",
    });
  }
  return snapshots;
}

export async function getSpendSnapshot(): Promise<SpendSnapshot> {
  const now = new Date();
  const day = new Date(now.getTime() - 24 * 3600_000);
  const week = new Date(now.getTime() - 7 * 24 * 3600_000);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  const daysIntoMonth = Math.max(1, Math.ceil((now.getTime() - month.getTime()) / (24 * 3600_000)));
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const [agg1d, agg7d, aggMonth] = await Promise.all([
    prisma.aIGeneration.aggregate({
      where: { createdAt: { gte: day } },
      _sum: { costUsd: true },
    }),
    prisma.aIGeneration.aggregate({
      where: { createdAt: { gte: week } },
      _sum: { costUsd: true },
    }),
    prisma.aIGeneration.aggregate({
      where: { createdAt: { gte: month } },
      _sum: { costUsd: true, promptTokens: true, completionTokens: true },
    }),
  ]);

  const thisMonthUsd = aggMonth._sum.costUsd ?? 0;
  const projectedMonthUsd = (thisMonthUsd / daysIntoMonth) * daysInMonth;

  return {
    last24hUsd: agg1d._sum.costUsd ?? 0,
    last7dUsd: agg7d._sum.costUsd ?? 0,
    thisMonthUsd,
    thisMonthTokens: (aggMonth._sum.promptTokens ?? 0) + (aggMonth._sum.completionTokens ?? 0),
    projectedMonthUsd,
    budgetUsd: TRIAL_CREDIT_USD,
    budgetRemainingUsd: Math.max(0, TRIAL_CREDIT_USD - thisMonthUsd),
    budgetPctUsed: pctOf(thisMonthUsd, TRIAL_CREDIT_USD),
  };
}
