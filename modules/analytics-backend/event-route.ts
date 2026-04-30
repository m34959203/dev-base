import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";

// Allowed event types (whitelist).
const EVENT_TYPES = new Set<string>([
  "pageview",
  "enrollment_click",
  "rent_request_submit",
  "chatbot_open",
  "quiz_complete",
]);

// Simple in-memory rate limit per IP: 20 req / minute.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const rateStore = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateStore.get(ip);
  if (!entry || entry.resetAt < now) {
    rateStore.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count += 1;
  return true;
}

function detectDevice(ua: string): string {
  const s = ua.toLowerCase();
  if (/ipad|tablet/.test(s)) return "tablet";
  if (/mobile|iphone|android.*mobile/.test(s)) return "mobile";
  return "desktop";
}

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  if (v.length === 0) return null;
  return v.slice(0, max);
}

function nonEmpty(v: unknown, max: number): string | null {
  const s = clampStr(v, max);
  return s;
}

export async function POST(request: NextRequest) {
  try {
    // --- Rate limit ---
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    if (!rateLimit(ip)) {
      return new Response(null, { status: 204 });
    }

    // --- Session cookie ---
    const cookieStore = await cookies();
    const sessionKey = cookieStore.get("dg_sid")?.value;
    if (!sessionKey || sessionKey.length > 64 || sessionKey.length < 8) {
      return new Response(JSON.stringify({ error: "no_session" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- Body ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "bad_json" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "bad_body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const b = body as Record<string, unknown>;
    const type = typeof b.type === "string" ? b.type : "";
    if (!EVENT_TYPES.has(type)) {
      return new Response(JSON.stringify({ error: "bad_type" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const path = nonEmpty(b.path, 500);
    if (path && path.length > 500) {
      return new Response(JSON.stringify({ error: "bad_path" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const referer = nonEmpty(b.referrer ?? b.referer, 1000);
    const utmSource = nonEmpty(b.utm_source, 100);
    const utmMedium = nonEmpty(b.utm_medium, 100);
    const utmCampaign = nonEmpty(b.utm_campaign, 100);
    const targetId =
      typeof b.target_id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.target_id)
        ? b.target_id
        : null;

    // meta — JSON object, <= 4KB serialized.
    let meta: Record<string, unknown> = {};
    if (b.meta && typeof b.meta === "object" && !Array.isArray(b.meta)) {
      const s = JSON.stringify(b.meta);
      if (s.length > 4096) {
        return new Response(JSON.stringify({ error: "meta_too_large" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      meta = b.meta as Record<string, unknown>;
    }

    const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 500);
    const deviceType = detectDevice(userAgent);
    const country = (request.headers.get("x-country") ?? "").slice(0, 2) || null;

    // --- Upsert session ---
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
        INSERT INTO analytics_sessions
          (session_key, first_path, utm_source, utm_medium, utm_campaign,
           referrer, device_type, user_agent, country, page_view_count, created_at, last_seen_at)
        VALUES
          ($1, COALESCE($2, ''), $3, $4, $5,
           $6, $7, $8, $9, $10, NOW(), NOW())
        ON CONFLICT (session_key) DO UPDATE SET
          last_seen_at = NOW(),
          page_view_count = analytics_sessions.page_view_count + CASE WHEN $11 = 'pageview' THEN 1 ELSE 0 END,
          utm_source = COALESCE(analytics_sessions.utm_source, EXCLUDED.utm_source),
          utm_medium = COALESCE(analytics_sessions.utm_medium, EXCLUDED.utm_medium),
          utm_campaign = COALESCE(analytics_sessions.utm_campaign, EXCLUDED.utm_campaign)
        `,
        [
          sessionKey,
          path,
          utmSource,
          utmMedium,
          utmCampaign,
          referer,
          deviceType,
          userAgent || null,
          country,
          type === "pageview" ? 1 : 0,
          type,
        ]
      );

      await client.query(
        `
        INSERT INTO analytics_events
          (session_key, type, path, referer, target_id, meta)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [sessionKey, type, path, referer, targetId, JSON.stringify(meta)]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("POST /api/analytics/event error:", error);
    // Don't leak details.
    return new Response(null, { status: 204 });
  }
}
