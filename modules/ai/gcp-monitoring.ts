import fs from "fs";
import { SignJWT, importPKCS8 } from "jose";

/**
 * Google Cloud Monitoring API client — reads real quota usage for the
 * Gemini API (generativelanguage.googleapis.com) in the provided project.
 *
 * Auth: OAuth2 service account (JWT Bearer grant).
 * Credentials: JSON key file path from env GCP_SA_FILE
 * (fallback: /home/ubuntu/technokod/secrets/gcp-monitoring.json).
 */

interface ServiceAccountKey {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

const SCOPE = "https://www.googleapis.com/auth/monitoring.read";
const DEFAULT_KEY_PATH =
  process.env.GCP_SA_FILE || "/app/secrets/gcp-monitoring.json";

let cachedKey: ServiceAccountKey | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

function loadKey(): ServiceAccountKey | null {
  if (cachedKey) return cachedKey;
  try {
    const raw = fs.readFileSync(DEFAULT_KEY_PATH, "utf8");
    cachedKey = JSON.parse(raw) as ServiceAccountKey;
    return cachedKey;
  } catch {
    return null;
  }
}

async function getAccessToken(): Promise<string | null> {
  const key = loadKey();
  if (!key) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.token;

  const privateKey = await importPKCS8(key.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: SCOPE,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(key.client_email)
    .setAudience(key.token_uri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const resp = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OAuth token exchange failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  const body = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("No access_token in response");
  cachedToken = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3500),
  };
  return cachedToken.token;
}

interface TimeSeriesPoint {
  interval: { startTime: string; endTime: string };
  value: { int64Value?: string; doubleValue?: number };
}

interface TimeSeries {
  metric: { type: string; labels: Record<string, string> };
  resource: { labels: Record<string, string> };
  points: TimeSeriesPoint[];
}

export interface GcpQuotaUsage {
  metric: string;            // e.g. "generate_content_free_tier_requests" or "quota/per_day"
  limitName: string;         // full quota metric name
  usage: number;             // current usage in window
  limit: number | null;      // configured limit (null if unknown)
  pct: number;               // usage/limit * 100 (0 if no limit)
  window: string;            // e.g. "per_minute", "per_day"
  model?: string;            // parsed from labels if available
  updatedAt: string;         // timestamp of latest point
}

function pointValue(p: TimeSeriesPoint): number {
  if (p.value.int64Value !== undefined) return Number(p.value.int64Value);
  if (p.value.doubleValue !== undefined) return p.value.doubleValue;
  return 0;
}

async function queryTimeSeries(
  token: string,
  projectId: string,
  filter: string,
  secondsBack: number,
): Promise<TimeSeries[]> {
  const end = new Date();
  const start = new Date(end.getTime() - secondsBack * 1000);
  const url = new URL(
    `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`,
  );
  url.searchParams.set("filter", filter);
  url.searchParams.set("interval.startTime", start.toISOString());
  url.searchParams.set("interval.endTime", end.toISOString());
  url.searchParams.set("aggregation.alignmentPeriod", "60s");
  url.searchParams.set("aggregation.perSeriesAligner", "ALIGN_MAX");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Monitoring query failed: ${resp.status} ${text.slice(0, 200)}`);
  }
  const body = (await resp.json()) as { timeSeries?: TimeSeries[] };
  return body.timeSeries ?? [];
}

/** Module-level cache to avoid hammering the API. TTL 60s. */
let usageCache: { data: GcpQuotaUsage[]; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getGcpQuotaUsage(): Promise<
  { ok: true; data: GcpQuotaUsage[]; projectId: string; cached: boolean }
  | { ok: false; error: string; projectId: string | null }
> {
  const key = loadKey();
  if (!key) {
    return {
      ok: false,
      error: "Service account JSON missing at " + DEFAULT_KEY_PATH,
      projectId: null,
    };
  }
  const projectId = key.project_id;
  const now = Date.now();
  if (usageCache && now - usageCache.at < CACHE_TTL_MS) {
    return { ok: true, data: usageCache.data, projectId, cached: true };
  }
  try {
    const token = await getAccessToken();
    if (!token) throw new Error("No access token");

    // Use api/request_count — always has data when there's any activity.
    // Query two windows: last 60 sec (per-minute feel) and last 24h (per-day).
    const filter =
      'metric.type = "serviceruntime.googleapis.com/api/request_count" ' +
      'AND resource.labels.service = "generativelanguage.googleapis.com"';

    const [perMin, perDay] = await Promise.all([
      queryTimeSeries(token, projectId, filter, 60),        // last 60 sec
      queryTimeSeries(token, projectId, filter, 24 * 3600), // last 24h
    ]);

    const sumPoints = (series: TimeSeries[]) =>
      series.reduce((acc, s) => acc + s.points.reduce((a, p) => a + pointValue(p), 0), 0);

    const rpm = sumPoints(perMin);
    const rpd = sumPoints(perDay);

    const latestTs =
      (perDay[0]?.points[0]?.interval.endTime) || new Date().toISOString();

    // Default free-tier references for visible % (Gemini 2.5 Flash)
    const rpmLimit = 10;
    const rpdLimit = 250;

    const data: GcpQuotaUsage[] = [
      {
        metric: "api/request_count",
        limitName: "Gemini API requests (last 60 sec) · free tier ref",
        usage: rpm,
        limit: rpmLimit,
        pct: rpmLimit ? (rpm / rpmLimit) * 100 : 0,
        window: "per_minute",
        updatedAt: latestTs,
      },
      {
        metric: "api/request_count",
        limitName: "Gemini API requests (last 24h) · free tier ref",
        usage: rpd,
        limit: rpdLimit,
        pct: rpdLimit ? (rpd / rpdLimit) * 100 : 0,
        window: "per_day",
        updatedAt: latestTs,
      },
    ];

    usageCache = { data, at: now };
    return { ok: true, data, projectId, cached: false };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Unknown",
      projectId,
    };
  }
}

/** Health check — verifies SA credentials + Monitoring API enabled. */
export async function pingGcpMonitoring(): Promise<
  { ok: true; projectId: string; email: string }
  | { ok: false; error: string }
> {
  const key = loadKey();
  if (!key) return { ok: false, error: "No SA key file" };
  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, error: "Token exchange failed" };
    // Minimal test call
    const resp = await fetch(
      `https://monitoring.googleapis.com/v3/projects/${key.project_id}/metricDescriptors?pageSize=1`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, error: `${resp.status} ${text.slice(0, 200)}` };
    }
    return { ok: true, projectId: key.project_id, email: key.client_email };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown" };
  }
}
