import axios, { type AxiosInstance, type AxiosError } from "axios";
import https from "https";
import { formatTelegramCaption } from "./templates";
import type { ArticleLike, Language, SocialConfigLike, TelegramCredentials, TelegramPublishResult } from "./types";

const API_URL = "https://api.telegram.org/bot";

const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  maxSockets: 50,
  maxFreeSockets: 10,
  rejectUnauthorized: true,
  family: 4, // Force IPv4 to avoid IPv6 reachability bugs in containers
});

const client: AxiosInstance = axios.create({
  timeout: 60_000,
  httpsAgent: agent,
});

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramMessageResult {
  message_id: number;
  chat: { id: number | string; username?: string };
}

function telegramError(err: unknown): string {
  const ax = err as AxiosError<{ description?: string }>;
  return ax.response?.data?.description ?? ax.message ?? "Unknown Telegram error";
}

async function callTelegram<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  maxRetries = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await client.post<TelegramApiResponse<T>>(
        `${API_URL}${botToken}/${method}`,
        body,
      );
      if (!res.data.ok) throw new Error(res.data.description ?? `Telegram ${method} failed`);
      return res.data.result;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        const delay = 1000 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`Telegram API Error: ${telegramError(lastErr)}`);
}

export async function sendTelegramMessage(
  credentials: TelegramCredentials,
  text: string,
): Promise<TelegramMessageResult> {
  return callTelegram<TelegramMessageResult>(credentials.botToken, "sendMessage", {
    chat_id: credentials.chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
}

export async function sendTelegramPhoto(
  credentials: TelegramCredentials,
  photoUrl: string,
  caption: string,
): Promise<TelegramMessageResult> {
  // Captions on photos have a 1024-char limit
  const trimmed = caption.length > 1024 ? `${caption.slice(0, 1020)}…` : caption;
  return callTelegram<TelegramMessageResult>(credentials.botToken, "sendPhoto", {
    chat_id: credentials.chatId,
    photo: encodeURI(photoUrl),
    caption: trimmed,
    parse_mode: "HTML",
  });
}

export function messageUrl(chatIdentifier: string | number, messageId: number): string {
  // Supports @public_channel and numeric -100... supergroups (t.me/c/<shortId>/<msgId>)
  const s = String(chatIdentifier);
  if (s.startsWith("@")) return `https://t.me/${s.slice(1)}/${messageId}`;
  if (s.startsWith("-100")) return `https://t.me/c/${s.slice(4)}/${messageId}`;
  return `https://t.me/${s}/${messageId}`;
}

export async function sendArticleToTelegram(
  article: ArticleLike,
  config: SocialConfigLike,
  lang: Language,
): Promise<TelegramPublishResult> {
  if (config.platform !== "TELEGRAM") {
    throw new Error("Config platform mismatch: expected TELEGRAM");
  }
  const creds = config.credentials as TelegramCredentials;
  if (!creds.botToken || !creds.chatId) {
    throw new Error("Telegram credentials missing botToken or chatId");
  }

  const caption = formatTelegramCaption(article, lang);

  const result: TelegramMessageResult = article.coverImage
    ? await sendTelegramPhoto(creds, article.coverImage, caption)
    : await sendTelegramMessage(creds, caption);

  return {
    messageId: result.message_id,
    chatId: String(creds.chatId),
    url: messageUrl(creds.chatId, result.message_id),
  };
}

export async function testTelegramConnection(credentials: TelegramCredentials): Promise<{ ok: true; botUsername: string }> {
  const me = await callTelegram<{ username: string; id: number }>(credentials.botToken, "getMe", {}, 1);
  // Try a lightweight getChat to validate chat access.
  await callTelegram(credentials.botToken, "getChat", { chat_id: credentials.chatId }, 1);
  return { ok: true, botUsername: me.username };
}
