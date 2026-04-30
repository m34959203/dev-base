/**
 * Shared types for social publishing.
 * Article / Tag / Category shapes here are the *minimum* required by the publisher.
 * They are intentionally structural so they overlap with Sprint 2's Prisma `Article`.
 */

export type Language = "kk" | "ru";

export interface ArticleCategoryLike {
  slug?: string | null;
  nameKk?: string | null;
  nameRu?: string | null;
}

export interface ArticleTagLike {
  slug?: string | null;
  nameKk?: string | null;
  nameRu?: string | null;
}

export interface ArticleLike {
  id: string;
  slugKk?: string | null;
  slugRu?: string | null;
  titleKk?: string | null;
  titleRu?: string | null;
  excerptKk?: string | null;
  excerptRu?: string | null;
  coverImage?: string | null;
  videoUrl?: string | null;
  isBreaking?: boolean | null;
  category?: ArticleCategoryLike | null;
  tags?: ArticleTagLike[] | null;
}

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

export interface InstagramCredentials {
  accessToken: string;
  pageId: string;
  igUserId?: string;
}

export type SocialCredentials = TelegramCredentials | InstagramCredentials;

export interface SocialConfigLike {
  id: string;
  platform: "TELEGRAM" | "INSTAGRAM";
  enabled: boolean;
  name: string;
  defaultLanguage: string;
  credentials: SocialCredentials;
}

export interface TelegramPublishResult {
  messageId: number;
  chatId: string;
  url: string;
}

export interface InstagramPublishResult {
  mediaId: string;
  url: string;
  isReel: boolean;
}
