# Playbook: AI-quota guard — никогда не выйти в платный тариф Gemini

**Цель:** ни один AI-запрос не пробивает free-tier Gemini, **даже если карта привязана**. Трёхуровневый guard блокирует на 90% от любого лимита (RPM / RPD / TPM).

**Источник:** technokod `src/lib/{ai-quota,gcp-monitoring,ai}.ts` + til-kural `sql/011_ai_usage.sql`.

## Когда это нужно

- Соло-проект с Gemini-привязанной картой → один забытый цикл генерации может стоить $50–200 за ночь.
- Multi-проект на одном GCP-ключе → нужно знать **реальный** расход с аккаунта (не только этого приложения).
- Demo-режим без ключа → нужно отдавать заглушку, не падать.

## Архитектура (3 уровня)

```
1. Pre-flight assertQuota(model)
   ↓ читает локальную таблицу ai_generations за 60с и 24ч
   ↓ сравнивает с FREE_TIER limits × SAFETY_RATIO=0.9
   ↓ если близко к 90% — бросает QuotaExceededError(scope, retryAfterSec)

2. Local DB log
   ↓ каждый Gemini-вызов пишется в ai_generations:
     provider, model, purpose, prompt_tokens, completion_tokens, cost_usd, duration_ms, user_id
   ↓ агрегаты считаются по этой таблице (быстро, без сети)

3. GCP Monitoring API (опционально, для multi-app сценария)
   ↓ getGcpQuotaUsage() — реальный расход от Google, кэш 60с
   ↓ JWT auth через jose (без google-auth-library)
   ↓ ловит расход других приложений на том же ключе
```

## Файлы

- [`modules/ai/quota-guard.ts`](../modules/ai/quota-guard.ts) — `assertQuota(model)`, `QuotaExceededError`, `FREE_TIER` table, `logGeneration()`
- [`modules/ai/gcp-monitoring.ts`](../modules/ai/gcp-monitoring.ts) — `getGcpQuotaUsage()` через Service Account JWT
- [`modules/ai/ai-client.ts`](../modules/ai/ai-client.ts) — unified Gemini→OpenRouter fallback с pricing + `assertQuota` интеграцией
- [`templates/sql/ai_generations.sql`](../templates/sql/ai_generations.sql) — миграция таблицы логов

## Установка

### 1. Применить миграцию

```bash
psql $DATABASE_URL -f templates/sql/ai_generations.sql
```

(Или Prisma: модель `AIGeneration` — поля совпадают, но snake_case через `@@map`.)

### 2. Положить файлы в `src/lib/`

```bash
mkdir -p src/lib
cp <dev-base>/modules/ai/quota-guard.ts src/lib/ai-quota.ts
cp <dev-base>/modules/ai/gcp-monitoring.ts src/lib/gcp-monitoring.ts
cp <dev-base>/modules/ai/ai-client.ts src/lib/ai.ts
```

### 3. Адаптировать импорты

В `quota-guard.ts` есть `import { prisma } from '@/lib/db'` — заменить на свой db-helper. Если raw pg — переписать `prisma.aIGeneration.aggregate({...})` на `pg.query('SELECT SUM(...)...')`.

### 4. (Опционально) GCP Service Account для real quota

```bash
# Создать SA с ролью `Monitoring Viewer`:
gcloud iam service-accounts create ai-quota-monitor \
  --display-name="AI Quota Monitor"

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:ai-quota-monitor@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/monitoring.viewer"

# Скачать JSON
gcloud iam service-accounts keys create gcp-monitoring.json \
  --iam-account=ai-quota-monitor@YOUR_PROJECT_ID.iam.gserviceaccount.com

# Положить в /app/secrets/gcp-monitoring.json (volume mount)
```

В `gcp-monitoring.ts` константа `PROJECT_ID` — переопределить под свой GCP project.

### 5. Использование

```ts
import { aiComplete } from '@/lib/ai';

const result = await aiComplete({
  prompt: 'Translate to KK: hello',
  system: 'You are a translator',
  purpose: 'translate',
  userId: user.id,
});
// → null если нет ключа (graceful demo-mode)
// → throws QuotaExceededError если близко к лимиту → API возвращает HTTP 429
// → string на успехе
```

В route-handler:

```ts
import { QuotaExceededError } from '@/lib/ai-quota';

try {
  const text = await aiComplete({ ... });
  return Response.json({ data: text });
} catch (err) {
  if (err instanceof QuotaExceededError) {
    return new Response(JSON.stringify({ error: 'quota', retry_after: err.retryAfterSec }), {
      status: 429,
      headers: { 'retry-after': String(err.retryAfterSec) },
    });
  }
  throw err;
}
```

## FREE_TIER limits (Gemini, на 2026-04)

```ts
const FREE_TIER = {
  'gemini-2.5-flash': { rpm: 15, rpd: 1500, tpm: 1_000_000 },
  'gemini-2.5-pro': { rpm: 5, rpd: 100, tpm: 250_000 },
  'gemini-2.5-flash-lite': { rpm: 30, rpd: 1500, tpm: 1_000_000 },
  'gemini-3.1-flash-tts-preview': { rpm: 3, rpd: 15, tpm: 32_000 },
  'gemini-2.5-flash-native-audio-preview-12-2025': { rpm: 3, rpd: 50, tpm: 32_000 },
};

const SAFETY_RATIO = 0.9; // блок на 90% от лимита
```

**Обновляй таблицу** при изменениях в free-tier (Google периодически правит лимиты — например, gemini-2.0 → 2.5).

## Подводные камни

- **Vision-вызовы** считают токены изображений как ~258 на картинку 768×768 (gemini-2.5-flash). Учитывай в `logGeneration()` через approxImageTokens.
- **Streaming** не возвращает `usageMetadata` сразу — приходится ждать конца стрима, чтобы залогировать.
- **Live native-audio** (Gemini Live) — отдельный лимит RPM=3, очень жёсткий. Для голосовых ассистентов фронт должен делать throttle на клиенте.
- **OpenRouter fallback** в `ai-client.ts` срабатывает на любой Gemini-ошибке. Платный (~$0.15 / 1M tokens для claude-haiku) — добавить отдельный budget-guard если боишься.
- **GCP Monitoring API** имеет лаг 1-3 минуты. Не полагаться на него для in-second блокировки — это второй контур.
- **Многомодельный счётчик** — `ai_generations` агрегирует по `model`, но free-tier разный. Запросы Pro и Flash считать отдельно.

## Метрики для дашборда

Из `ai_generations` строится:
- **Suтогда сегодня** — `SUM(cost_usd) WHERE created_at > NOW() - 1d`
- **Запросов за минуту** — `COUNT(*) WHERE created_at > NOW() - 60s`
- **Близость к лимиту** — `current_rpm / FREE_TIER[model].rpm * 100%`
- **Top пользователи** — `SUM(prompt_tokens + completion_tokens) GROUP BY user_id ORDER BY DESC LIMIT 10`
- **Top purpose** — `COUNT(*) GROUP BY purpose` (chat / vision / exercises / writing-check / live-token)

См. также: `prompts/seo-meta-from-content.md`, `playbooks/build-multi-agent.md`.
