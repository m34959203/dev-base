import axios, { type AxiosError } from "axios";
import { formatInstagramCaption } from "./templates";
import type {
  ArticleLike,
  InstagramCredentials,
  InstagramPublishResult,
  Language,
  SocialConfigLike,
} from "./types";

const INSTAGRAM_API_URL = "https://graph.instagram.com";
const FACEBOOK_API_URL = "https://graph.facebook.com/v21.0";

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000];
const CONTAINER_CHECK_INTERVAL = 3000;
const CONTAINER_CHECK_MAX_ATTEMPTS = 20;

function getApiUrl(token: string): string {
  return token.startsWith("IG") ? INSTAGRAM_API_URL : FACEBOOK_API_URL;
}

function igErr(err: unknown): string {
  const ax = err as AxiosError<{ error?: { message?: string } }>;
  return ax.response?.data?.error?.message ?? ax.message ?? "Unknown Instagram error";
}

function isTransient(err: unknown): boolean {
  const ax = err as AxiosError<{ error?: { is_transient?: boolean; code?: number } }>;
  const e = ax.response?.data?.error;
  return Boolean(e?.is_transient) || e?.code === 2;
}

async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await op();
    } catch (e) {
      last = e;
      if (!isTransient(e)) throw e;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
  }
  throw last;
}

function encodeMediaUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const encoded = url.pathname
      .split("/")
      .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
      .join("/");
    return `${url.protocol}//${url.host}${encoded}${url.search}`;
  } catch {
    return raw;
  }
}

interface ContainerStatus {
  status: string;
  errorMessage?: string;
}

async function checkContainerStatus(token: string, containerId: string): Promise<ContainerStatus> {
  const api = getApiUrl(token);
  try {
    const res = await axios.get<{ status_code?: string; status?: string }>(`${api}/${containerId}`, {
      params: { fields: "status_code,status", access_token: token },
      timeout: 30_000,
    });
    return { status: res.data.status_code ?? res.data.status ?? "UNKNOWN", errorMessage: res.data.status };
  } catch (e) {
    return { status: "ERROR", errorMessage: igErr(e) };
  }
}

async function waitForContainer(token: string, containerId: string): Promise<void> {
  for (let i = 0; i < CONTAINER_CHECK_MAX_ATTEMPTS; i++) {
    const s = await checkContainerStatus(token, containerId);
    if (s.status === "FINISHED") return;
    if (s.status === "ERROR" || s.status === "EXPIRED") {
      throw new Error(`Instagram container failed: ${s.status} ${s.errorMessage ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, CONTAINER_CHECK_INTERVAL));
  }
  throw new Error(`Instagram container ${containerId} did not finish in time`);
}

async function createImageContainer(
  token: string,
  pageId: string,
  imageUrl: string,
  caption: string,
): Promise<string> {
  const api = getApiUrl(token);
  const res = await withRetry(() =>
    axios.post<{ id: string }>(`${api}/${pageId}/media`, null, {
      params: { image_url: encodeMediaUrl(imageUrl), caption, access_token: token },
      timeout: 60_000,
    }),
  );
  return res.data.id;
}

async function createReelsContainer(
  token: string,
  pageId: string,
  videoUrl: string,
  caption: string,
): Promise<string> {
  const api = getApiUrl(token);
  const res = await withRetry(() =>
    axios.post<{ id: string }>(`${api}/${pageId}/media`, null, {
      params: {
        media_type: "REELS",
        video_url: encodeMediaUrl(videoUrl),
        caption,
        share_to_feed: true,
        access_token: token,
      },
      timeout: 60_000,
    }),
  );
  return res.data.id;
}

async function publishContainer(token: string, pageId: string, containerId: string): Promise<string> {
  const api = getApiUrl(token);
  const res = await withRetry(() =>
    axios.post<{ id: string }>(`${api}/${pageId}/media_publish`, null, {
      params: { creation_id: containerId, access_token: token },
      timeout: 60_000,
    }),
  );
  return res.data.id;
}

async function getMediaPermalink(token: string, mediaId: string): Promise<string | null> {
  const api = getApiUrl(token);
  try {
    const res = await axios.get<{ permalink?: string }>(`${api}/${mediaId}`, {
      params: { fields: "permalink", access_token: token },
      timeout: 30_000,
    });
    return res.data.permalink ?? null;
  } catch {
    return null;
  }
}

export async function publishArticleToInstagram(
  article: ArticleLike,
  config: SocialConfigLike,
  lang: Language,
): Promise<InstagramPublishResult> {
  if (config.platform !== "INSTAGRAM") {
    throw new Error("Config platform mismatch: expected INSTAGRAM");
  }
  const creds = config.credentials as InstagramCredentials;
  if (!creds.accessToken || !creds.pageId) {
    throw new Error("Instagram credentials missing accessToken or pageId");
  }

  const caption = formatInstagramCaption(article, lang);
  if (caption.length > 2200) {
    throw new Error(`Instagram caption too long: ${caption.length} > 2200`);
  }

  const hasVideo = Boolean(article.videoUrl);
  if (!hasVideo && !article.coverImage) {
    throw new Error("Instagram post requires either videoUrl or coverImage");
  }

  let containerId: string;
  if (hasVideo && article.videoUrl) {
    containerId = await createReelsContainer(creds.accessToken, creds.pageId, article.videoUrl, caption);
  } else if (article.coverImage) {
    containerId = await createImageContainer(creds.accessToken, creds.pageId, article.coverImage, caption);
  } else {
    throw new Error("Instagram post requires media");
  }

  await waitForContainer(creds.accessToken, containerId);
  const mediaId = await publishContainer(creds.accessToken, creds.pageId, containerId);
  const permalink = await getMediaPermalink(creds.accessToken, mediaId);

  return {
    mediaId,
    url: permalink ?? `https://www.instagram.com/p/${mediaId}`,
    isReel: hasVideo,
  };
}

export async function testInstagramConnection(credentials: InstagramCredentials): Promise<{ ok: true; username: string }> {
  const api = getApiUrl(credentials.accessToken);
  try {
    const res = await axios.get<{ username: string; id: string }>(`${api}/${credentials.pageId}`, {
      params: { fields: "username,id", access_token: credentials.accessToken },
      timeout: 30_000,
    });
    return { ok: true, username: res.data.username };
  } catch (e) {
    throw new Error(`Instagram connection failed: ${igErr(e)}`);
  }
}
