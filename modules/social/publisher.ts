import { prisma } from "@/lib/db";
import type { Prisma, SocialMediaConfig, SocialMediaPublication } from "@prisma/client";
import { decryptCredentials, isEncryptedBlob } from "./encryption";
import { sendArticleToTelegram } from "./telegram";
import { publishArticleToInstagram } from "./instagram";
import type {
  ArticleLike,
  InstagramCredentials,
  Language,
  SocialConfigLike,
  TelegramCredentials,
} from "./types";

export type PublishablePlatform = "TELEGRAM" | "INSTAGRAM";

export interface PublishResultItem {
  platform: PublishablePlatform;
  language: Language;
  publicationId: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  externalId?: string;
  url?: string;
  errorMessage?: string;
}

export interface PublishReport {
  articleId: string;
  items: PublishResultItem[];
}

function toConfigLike(row: SocialMediaConfig): SocialConfigLike {
  const raw = row.credentials;
  const decrypted = isEncryptedBlob(raw)
    ? decryptCredentials<Record<string, unknown>>(raw)
    : (raw as unknown as Record<string, unknown>);

  return {
    id: row.id,
    platform: row.platform,
    enabled: row.enabled,
    name: row.name,
    defaultLanguage: row.defaultLanguage,
    credentials: decrypted as unknown as SocialConfigLike["credentials"],
  };
}

async function loadArticle(articleId: string): Promise<ArticleLike> {
  // Uses Sprint 2's Article model; category & tags optional.
  const a = await (prisma as unknown as {
    article: {
      findUnique: (args: { where: { id: string }; include?: unknown }) => Promise<ArticleLike | null>;
    };
  }).article.findUnique({
    where: { id: articleId },
    include: { category: true, tags: true },
  });
  if (!a) throw new Error(`Article ${articleId} not found`);
  return a;
}

async function pickConfig(platform: PublishablePlatform): Promise<SocialConfigLike | null> {
  const row = await prisma.socialMediaConfig.findFirst({
    where: { platform, enabled: true },
    orderBy: { updatedAt: "desc" },
  });
  return row ? toConfigLike(row) : null;
}

/**
 * Idempotent per (articleId, platform, language): if an existing SUCCESS publication
 * exists, we return it as SKIPPED instead of double-posting.
 */
async function existingSuccess(
  articleId: string,
  platform: PublishablePlatform,
  language: Language,
): Promise<SocialMediaPublication | null> {
  return prisma.socialMediaPublication.findFirst({
    where: { articleId, platform, language, status: "SUCCESS" },
  });
}

async function recordAnalyticsEvent(articleId: string, platform: PublishablePlatform): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        type: "ARTICLE_VIEW",
        path: `/social/publish/${platform.toLowerCase()}`,
        articleId,
      },
    });
  } catch {
    // analytics failures must never break a publish
  }
}

export async function publishArticle(
  articleId: string,
  platforms: PublishablePlatform[],
  lang?: Language,
): Promise<PublishReport> {
  const article = await loadArticle(articleId);
  const items: PublishResultItem[] = [];

  for (const platform of platforms) {
    const config = await pickConfig(platform);
    const language: Language = (lang ?? (config?.defaultLanguage as Language | undefined) ?? "ru");

    if (!config || !config.enabled) {
      const pub = await prisma.socialMediaPublication.create({
        data: {
          articleId,
          platform,
          language,
          status: "FAILED",
          errorMessage: `No enabled config for platform ${platform}`,
          payload: {},
          attempts: 1,
        },
      });
      items.push({
        platform,
        language,
        publicationId: pub.id,
        status: "FAILED",
        errorMessage: pub.errorMessage ?? undefined,
      });
      continue;
    }

    const prior = await existingSuccess(articleId, platform, language);
    if (prior) {
      items.push({
        platform,
        language,
        publicationId: prior.id,
        status: "SKIPPED",
        externalId: prior.externalId ?? undefined,
        url: prior.url ?? undefined,
      });
      continue;
    }

    const pub = await prisma.socialMediaPublication.create({
      data: {
        articleId,
        platform,
        language,
        status: "PENDING",
        payload: { configId: config.id } as Prisma.InputJsonValue,
        attempts: 1,
      },
    });

    try {
      if (platform === "TELEGRAM") {
        const r = await sendArticleToTelegram(article, config, language);
        const updated = await prisma.socialMediaPublication.update({
          where: { id: pub.id },
          data: {
            status: "SUCCESS",
            externalId: String(r.messageId),
            url: r.url,
            publishedAt: new Date(),
            payload: { configId: config.id, chatId: r.chatId } as Prisma.InputJsonValue,
          },
        });
        items.push({
          platform,
          language,
          publicationId: updated.id,
          status: "SUCCESS",
          externalId: updated.externalId ?? undefined,
          url: updated.url ?? undefined,
        });
      } else {
        const r = await publishArticleToInstagram(article, config, language);
        const updated = await prisma.socialMediaPublication.update({
          where: { id: pub.id },
          data: {
            status: "SUCCESS",
            externalId: r.mediaId,
            url: r.url,
            publishedAt: new Date(),
            payload: { configId: config.id, isReel: r.isReel } as Prisma.InputJsonValue,
          },
        });
        items.push({
          platform,
          language,
          publicationId: updated.id,
          status: "SUCCESS",
          externalId: updated.externalId ?? undefined,
          url: updated.url ?? undefined,
        });
      }
      await recordAnalyticsEvent(articleId, platform);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = await prisma.socialMediaPublication.update({
        where: { id: pub.id },
        data: { status: "FAILED", errorMessage: message },
      });
      items.push({
        platform,
        language,
        publicationId: updated.id,
        status: "FAILED",
        errorMessage: message,
      });
    }
  }

  return { articleId, items };
}

export async function retryPublication(publicationId: string): Promise<PublishResultItem> {
  const pub = await prisma.socialMediaPublication.findUnique({ where: { id: publicationId } });
  if (!pub) throw new Error(`Publication ${publicationId} not found`);
  if (pub.status === "SUCCESS") {
    return {
      platform: pub.platform as PublishablePlatform,
      language: pub.language as Language,
      publicationId: pub.id,
      status: "SKIPPED",
      externalId: pub.externalId ?? undefined,
      url: pub.url ?? undefined,
    };
  }
  const article = await loadArticle(pub.articleId);
  const config = await pickConfig(pub.platform as PublishablePlatform);
  if (!config) throw new Error(`No enabled config for ${pub.platform}`);

  await prisma.socialMediaPublication.update({
    where: { id: pub.id },
    data: { status: "PENDING", attempts: { increment: 1 }, errorMessage: null },
  });

  try {
    if (pub.platform === "TELEGRAM") {
      const r = await sendArticleToTelegram(article, config, pub.language as Language);
      const u = await prisma.socialMediaPublication.update({
        where: { id: pub.id },
        data: {
          status: "SUCCESS",
          externalId: String(r.messageId),
          url: r.url,
          publishedAt: new Date(),
        },
      });
      return {
        platform: "TELEGRAM",
        language: pub.language as Language,
        publicationId: u.id,
        status: "SUCCESS",
        externalId: u.externalId ?? undefined,
        url: u.url ?? undefined,
      };
    }
    const r = await publishArticleToInstagram(article, config, pub.language as Language);
    const u = await prisma.socialMediaPublication.update({
      where: { id: pub.id },
      data: {
        status: "SUCCESS",
        externalId: r.mediaId,
        url: r.url,
        publishedAt: new Date(),
      },
    });
    return {
      platform: "INSTAGRAM",
      language: pub.language as Language,
      publicationId: u.id,
      status: "SUCCESS",
      externalId: u.externalId ?? undefined,
      url: u.url ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.socialMediaPublication.update({
      where: { id: pub.id },
      data: { status: "FAILED", errorMessage: message },
    });
    return {
      platform: pub.platform as PublishablePlatform,
      language: pub.language as Language,
      publicationId: pub.id,
      status: "FAILED",
      errorMessage: message,
    };
  }
}

export type { TelegramCredentials, InstagramCredentials };
