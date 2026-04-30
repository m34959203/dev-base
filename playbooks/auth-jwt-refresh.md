# Playbook: JWT auth + refresh-tokens kit (Edge-friendly)

**Стек:** Next.js 16 App Router + jose (HS256) + argon2 + Postgres.
**Архитектура:** короткий access (1h) в HttpOnly cookie + долгий refresh (30d) с rotation + revoke list + Edge-verify в middleware **без `jose` в Edge bundle**.

**Источник:** technokod `src/lib/auth.ts` + til-kural `src/lib/refresh-tokens.ts` + til-kural `middleware.ts` + til-kural `sql/010_refresh_tokens.sql`.

## Зачем

Стандартный auth-стек, который должен быть в каждом серьёзном Next.js проекте:

- **Access token** (JWT HS256) живёт 1 час — компрометация ограничена.
- **Refresh token** (30 дней) хранится **хешированным** в БД (`sha256`), при logout/revoke — удаляется. Поддерживает logout-from-all-devices.
- **Rotation**: при каждом обновлении access — старый refresh инвалидируется, выдаётся новый.
- **Edge-verify** в `middleware.ts` через WebCrypto API (без `jose`-зависимости) — middleware bundle остаётся ≤30KB.
- **`requireRole(["admin", "editor"])`** + `AuthError` стандарт (memory feedback `technokod_roles`).

## Файлы

- [`modules/auth/jwt-node.ts`](../modules/auth/jwt-node.ts) — server-side: `signToken`, `verifyToken`, `requireUser`, `requireRole`, `AuthError`. Использует `jose` (полный) в Node-runtime.
- [`modules/auth/refresh-tokens.ts`](../modules/auth/refresh-tokens.ts) — `issueRefreshToken`, `consumeRefreshToken` (rotation), `revokeRefreshToken`, `revokeAllForUser`. Хеширует refresh через sha256 + UA/IP логирование.
- [`modules/auth/middleware-edge-jwt.ts`](../modules/auth/middleware-edge-jwt.ts) — Edge-runtime JWT verify через WebCrypto. Защищает `/admin/*`, инжектит security headers, rate-limit для AI/auth.
- [`templates/sql/refresh_tokens.sql`](../templates/sql/refresh_tokens.sql) — миграция `refresh_tokens` таблицы.

## Установка

### 1. Применить миграцию

```bash
psql $DATABASE_URL -f templates/sql/refresh_tokens.sql
```

### 2. Положить файлы

```bash
mkdir -p src/lib
cp <dev-base>/modules/auth/jwt-node.ts src/lib/auth.ts
cp <dev-base>/modules/auth/refresh-tokens.ts src/lib/refresh-tokens.ts
cp <dev-base>/modules/auth/middleware-edge-jwt.ts src/middleware.ts
```

### 3. Прописать env

```env
AUTH_SECRET=<32-bytes-base64>           # JWT signing key для access
REFRESH_SECRET=<32-bytes-base64>         # отдельный для refresh hash (опционально)
```

Сгенерировать:
```bash
openssl rand -base64 32
```

### 4. Cookie names

В `auth.ts` константы — переименовать под свой проект:
- `tk_session` → `your_app_session` (access)
- `tk_refresh` → `your_app_refresh` (refresh)

## Использование

### Login flow

```ts
// app/api/auth/login/route.ts
import { signToken } from '@/lib/auth';
import { issueRefreshToken } from '@/lib/refresh-tokens';
import { rateLimit, clientKey, rateLimitResponse } from '@/lib/rate-limit';
import argon2 from 'argon2';

export async function POST(req: Request) {
  const rl = rateLimit(clientKey(req, 'login'), 5, 15 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl);

  const { email, password } = await req.json();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await argon2.verify(user.passwordHash, password)) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const access = await signToken({ userId: user.id, role: user.role, email });
  const refresh = await issueRefreshToken(user.id, req);

  const res = Response.json({ ok: true, user: { id: user.id, role: user.role } });
  res.headers.append('Set-Cookie', `tk_session=${access}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`);
  res.headers.append('Set-Cookie', `tk_refresh=${refresh}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
  return res;
}
```

### Refresh flow

```ts
// app/api/auth/refresh/route.ts
import { consumeRefreshToken } from '@/lib/refresh-tokens';
import { signToken } from '@/lib/auth';

export async function POST(req: Request) {
  const refresh = req.headers.get('cookie')?.match(/tk_refresh=([^;]+)/)?.[1];
  if (!refresh) return Response.json({ error: 'No refresh' }, { status: 401 });

  const result = await consumeRefreshToken(refresh, req);
  if (!result) return Response.json({ error: 'Invalid refresh' }, { status: 401 });

  const access = await signToken({ userId: result.user.id, role: result.user.role, email: result.user.email });
  const res = Response.json({ ok: true });
  res.headers.append('Set-Cookie', `tk_session=${access}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`);
  res.headers.append('Set-Cookie', `tk_refresh=${result.newRefreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
  return res;
}
```

### Защищённый эндпоинт

```ts
// app/api/admin/users/route.ts
import { requireRole, AuthError } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const user = await requireRole(['admin', 'editor']);
    const users = await prisma.user.findMany();
    return Response.json({ data: users });
  } catch (err) {
    if (err instanceof AuthError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
```

**Правило (memory feedback):** в админ-роутах ВСЕГДА `["admin", "editor"]` + try/catch AuthError, иначе route падает в 500.

### Logout

```ts
import { revokeRefreshToken } from '@/lib/refresh-tokens';

export async function POST(req: Request) {
  const refresh = req.headers.get('cookie')?.match(/tk_refresh=([^;]+)/)?.[1];
  if (refresh) await revokeRefreshToken(refresh);
  const res = Response.json({ ok: true });
  res.headers.append('Set-Cookie', 'tk_session=; HttpOnly; Path=/; Max-Age=0');
  res.headers.append('Set-Cookie', 'tk_refresh=; HttpOnly; Path=/; Max-Age=0');
  return res;
}
```

### Logout from ALL devices

```ts
import { revokeAllForUser } from '@/lib/refresh-tokens';
await revokeAllForUser(userId); // все refresh-токены этого юзера → удалены
```

## Edge middleware (защита `/admin/*`)

`middleware-edge-jwt.ts` использует **WebCrypto** вместо `jose` — bundle ~5KB вместо ~80KB. Это критично для Edge runtime (Cloudflare Workers / Vercel Edge).

Что делает:
1. Проверяет JWT из cookie `tk_session` (HS256 verify через `crypto.subtle`).
2. Если 401 — редиректит на `/admin/login` (для UI-роутов) или 401 JSON (для API).
3. Инжектит security headers (CSP, X-Frame-Options, Permissions-Policy).
4. Rate-limit на `/api/auth/*` и `/api/ai/*` (через cookie session + IP).

## Подводные камни

- **`UserPayload`** в JWT содержит `userId`, **не** `id`. Это payload, не модель — путаница частая.
- **Rotation** работает только если client делает refresh-запрос в течение 30 дней. После — нужен полный re-login.
- **Sha256 хеш refresh** в БД — никогда не храним plain. При утечке БД refresh-токены не используемы (только если есть само значение в куке).
- **Logout-from-all-devices** должен быть кнопкой в админке — иначе пользователи не знают, что это есть.
- **DEV_ADMIN_BYPASS=1** в .env (til-kural паттерн) — открывает `/admin/*` без логина в dev. **Никогда** в prod.
- **AUTH_SECRET ротация** — при изменении все access-токены инвалидируются мгновенно (что хорошо при компрометации). Refresh — продолжают работать (хешированы своим алгоритмом).

## Related

- [`modules/auth/rate-limit-pg.ts`](../modules/auth/rate-limit-pg.ts) / `rate-limit-memory.ts` — обязательные на login/refresh
- См. `templates/sql/refresh_tokens.sql` для DDL (FK на users, индексы)
