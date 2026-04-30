import { z } from "zod";

export const telegramCredentialsSchema = z.object({
  botToken: z.string().min(10),
  chatId: z.string().min(1),
});

export const instagramCredentialsSchema = z.object({
  accessToken: z.string().min(10),
  pageId: z.string().min(1),
  businessAccountId: z.string().optional(),
});

export type TelegramCredentials = z.infer<typeof telegramCredentialsSchema>;
export type InstagramCredentials = z.infer<typeof instagramCredentialsSchema>;

export function parseTelegramCredentials(raw: unknown): TelegramCredentials {
  return telegramCredentialsSchema.parse(raw);
}

export function parseInstagramCredentials(raw: unknown): InstagramCredentials {
  return instagramCredentialsSchema.parse(raw);
}
