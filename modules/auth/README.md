# modules/auth/

Auth + rate-limit kit для Next.js / Node проектов. Источник: technokod + til-kural production.

## Файлы

### Rate-limit (token bucket)
- [`rate-limit-memory.ts`](rate-limit-memory.ts) — in-process bucket. **Single-instance** (single docker-контейнер, single Vercel region). Простой, без зависимостей. Подходит для 90% соло-проектов.
- [`rate-limit-pg.ts`](rate-limit-pg.ts) — Postgres-backed с `SELECT ... FOR UPDATE` в транзакции. **Multi-instance**: docker-compose со scale=2+, k8s, blue-green deploy. Падает обратно на in-memory если БД недоступна.

### Пресет лимитов

В `rate-limit-pg.ts` есть `RATE_LIMITS` константа — пример пресета по типам эндпоинтов. Скопируй и адаптируй:

```ts
export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60_000 },        // 5 попыток за 15 мин
  leads: { limit: 5, windowMs: 10 * 60_000 },        // 5 заявок за 10 мин с IP
  ai_translate: { limit: 30, windowMs: 60 * 60_000 }, // 30 переводов в час
  ai_chat: { limit: 60, windowMs: 60 * 60_000 },     // 60 сообщений в час
  upload: { limit: 20, windowMs: 60 * 60_000 },      // 20 файлов в час
};
```

### JWT (см. также `jwt-node.ts` / `jwt-edge.ts` в этой папке) — отдельная задача

## Использование

### Memory-вариант (минимум зависимостей)

```ts
import { rateLimit, clientKey, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, 'leads'), 5, 10 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl);
  // ... остальная логика
}
```

### PG-вариант (multi-instance)

```ts
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit-pg';

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anon';
  const rl = await rateLimit({ key: `leads:${ip}`, ...RATE_LIMITS.leads });
  if (!rl.ok) {
    return new Response('Too many requests', { status: 429, headers: rl.headers });
  }
  // ...
}
```

## Адаптация при копировании

1. **Импорты** — заменить `@/lib/db` (Prisma client) и `@/lib/logger` на свои.
2. **Схема БД** — если у тебя raw pg вместо Prisma, использовать SQL из шапки `rate-limit-pg.ts`.
3. **Cleanup** — оба варианта чистят старые ключи через interval; в memory: 5 мин; в PG: за счёт того, что bucket обновляется каждый раз, накопления нет.
4. **Custom keys** — `clientKey(req, scope)` берёт IP из `x-forwarded-for` → подходит для Cloudflare/Vercel/Plesk; для других прокси проверь, какой header правильный.
