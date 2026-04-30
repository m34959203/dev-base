/**
 * Simple in-process token bucket rate limiter.
 * For single-instance deploys it's enough; for multi-instance swap for Redis.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetMs: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { tokens: limit - 1, updatedAt: now });
    return { ok: true, remaining: limit - 1, resetMs: windowMs };
  }
  const elapsed = now - bucket.updatedAt;
  const refill = Math.floor((elapsed / windowMs) * limit);
  const tokens = Math.min(limit, bucket.tokens + refill);
  if (tokens <= 0) {
    return { ok: false, remaining: 0, resetMs: windowMs - (elapsed % windowMs) };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: refill > 0 ? now : bucket.updatedAt });
  return { ok: true, remaining: tokens - 1, resetMs: windowMs };
}

export function clientKey(request: Request, scope: string): string {
  const fwd = request.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'anon';
  return `${scope}:${ip}`;
}

export function rateLimitResponse(result: RateLimitResult) {
  return Response.json(
    { error: 'Too many requests', retry_after_ms: result.resetMs },
    {
      status: 429,
      headers: {
        'retry-after': String(Math.ceil(result.resetMs / 1000)),
        'x-ratelimit-remaining': '0',
      },
    },
  );
}

// Periodic GC so the map doesn't grow unbounded
if (typeof setInterval !== 'undefined' && process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.updatedAt > 10 * 60 * 1000) buckets.delete(key);
    }
  }, 5 * 60 * 1000).unref?.();
}
