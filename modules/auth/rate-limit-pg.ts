/**
 * rate-limit-pg.ts — Postgres-backed token-bucket rate limiter с in-memory
 * fallback. Между инстансами устойчив через `SELECT ... FOR UPDATE` в транзакции.
 *
 * Когда использовать: multi-instance deploy (docker-compose со scale=2+, k8s, blue-green).
 * Для single-instance проще `rate-limit-memory.ts`.
 *
 * Зависимости (адаптируй под свой проект):
 *   1. Prisma модель — для `prisma`-стека:
 *      model RateLimitBucket {
 *        key          String   @id
 *        tokens       Float
 *        lastRefillAt DateTime
 *      }
 *   2. SQL-эквивалент для raw pg:
 *      CREATE TABLE rate_limit_buckets (
 *        key VARCHAR(255) PRIMARY KEY,
 *        tokens DOUBLE PRECISION NOT NULL,
 *        last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *      );
 *   3. Импорты `@/lib/db` (Prisma client) и `@/lib/logger` — заменить под свой стек.
 *
 * Usage:
 *   const rl = await rateLimit({ key: `leads:${ip}`, limit: 5, windowMs: 10*60_000 });
 *   if (!rl.ok) return new Response("rate limited", { status: 429, headers: rl.headers });
 */
import { prisma } from "@/lib/db";   // ← заменить под свой db-helper
import { logger } from "@/lib/logger"; // ← заменить под свой logger

export type RateLimitOpts = {
  /** Unique bucket identifier, e.g. `leads:1.2.3.4` or `ai:user-uuid`. */
  key: string;
  /** Max tokens (= max requests per window). */
  limit: number;
  /** Refill window in ms — tokens refill at rate = limit/windowMs. */
  windowMs: number;
  /** Tokens consumed per call (default 1). */
  cost?: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  limit: number;
  resetSeconds: number;
  headers: Record<string, string>;
};

// ─── In-memory fallback ─────────────────────────────────────────────────────
type MemBucket = { tokens: number; lastRefillAt: number };
const memory = new Map<string, MemBucket>();

function memBucket(opts: RateLimitOpts, now: number): RateLimitResult {
  const { key, limit, windowMs, cost = 1 } = opts;
  const refillPerMs = limit / windowMs;
  let b = memory.get(key);
  if (!b) b = { tokens: limit, lastRefillAt: now };
  const elapsed = now - b.lastRefillAt;
  b.tokens = Math.min(limit, b.tokens + elapsed * refillPerMs);
  b.lastRefillAt = now;
  const allowed = b.tokens >= cost;
  if (allowed) b.tokens -= cost;
  memory.set(key, b);
  const remaining = Math.max(0, Math.floor(b.tokens));
  const resetSeconds = Math.ceil((limit - b.tokens) / refillPerMs / 1000);
  return {
    ok: allowed,
    remaining,
    limit,
    resetSeconds,
    headers: rateHeaders(limit, remaining, resetSeconds, allowed),
  };
}

function rateHeaders(limit: number, remaining: number, resetSeconds: number, ok: boolean) {
  const h: Record<string, string> = {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(resetSeconds),
  };
  if (!ok) h["Retry-After"] = String(Math.max(1, resetSeconds));
  return h;
}

// ─── Postgres-backed bucket ─────────────────────────────────────────────────
async function dbBucket(opts: RateLimitOpts, now: Date): Promise<RateLimitResult> {
  const { key, limit, windowMs, cost = 1 } = opts;
  const refillPerMs = limit / windowMs;

  // We must use $transaction + raw SQL to get SELECT FOR UPDATE atomicity.
  void prisma; // ensure import not elided

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<
      { key: string; tokens: number; last_refill_at: Date }[]
    >(
      `SELECT "key","tokens","lastRefillAt" AS last_refill_at
         FROM "RateLimitBucket"
        WHERE "key" = $1
        FOR UPDATE`,
      key,
    );

    let tokens = limit;
    let lastRefillAt = now;
    if (rows.length > 0) {
      tokens = Number(rows[0].tokens);
      lastRefillAt = new Date(rows[0].last_refill_at);
    }
    const elapsed = now.getTime() - lastRefillAt.getTime();
    tokens = Math.min(limit, tokens + elapsed * refillPerMs);
    const allowed = tokens >= cost;
    if (allowed) tokens -= cost;

    await tx.$executeRawUnsafe(
      `INSERT INTO "RateLimitBucket" ("key","tokens","lastRefillAt")
       VALUES ($1, $2, $3)
       ON CONFLICT ("key")
       DO UPDATE SET "tokens" = EXCLUDED."tokens", "lastRefillAt" = EXCLUDED."lastRefillAt"`,
      key,
      tokens,
      now,
    );

    const remaining = Math.max(0, Math.floor(tokens));
    const resetSeconds = Math.ceil((limit - tokens) / refillPerMs / 1000);
    return {
      ok: allowed,
      remaining,
      limit,
      resetSeconds,
      headers: rateHeaders(limit, remaining, resetSeconds, allowed),
    };
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────
let dbHealthy = true;

export async function rateLimit(opts: RateLimitOpts): Promise<RateLimitResult> {
  const now = new Date();
  if (dbHealthy && process.env.DATABASE_URL) {
    try {
      return await dbBucket(opts, now);
    } catch (err) {
      logger.warn("rate_limit.db_fallback", { err, key: opts.key });
      dbHealthy = false;
      // schedule re-check
      setTimeout(() => {
        dbHealthy = true;
      }, 30_000);
    }
  }
  return memBucket(opts, now.getTime());
}

// ─── Helpers for common buckets ─────────────────────────────────────────────
export function ipFromRequest(req: Request): string {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    (h.get("x-forwarded-for") ?? "").split(",")[0].trim() ??
    "0.0.0.0"
  ).trim() || "0.0.0.0";
}

export const RATE_LIMITS = {
  leads: { limit: 5, windowMs: 10 * 60_000 },          // 5/10min/IP
  authLogin: { limit: 5, windowMs: 5 * 60_000 },       // 5/5min/IP
  ai: { limit: 20, windowMs: 60 * 60_000 },            // 20/hour/user
  analyticsTrack: { limit: 120, windowMs: 60_000 },    // 120/min/IP
} as const;

// ─── Legacy alias for Sprint 1 code ────────────────────────────────────────
export function clientIp(req: Request): string {
  return ipFromRequest(req);
}
