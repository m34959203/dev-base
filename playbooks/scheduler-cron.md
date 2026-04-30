# Playbook: Durable scheduler (DB-CAS jobs + cron-tick + retry)

**Цель:** надёжный планировщик задач для Next.js: переживает рестарты, не дублирует выполнение в multi-instance, поддерживает exponential backoff retry.

**Источник:** technokod `src/lib/scheduler.ts` + `src/app/api/cron/tick/route.ts`.

## Архитектура

```
ScheduledJob table
  ├─ type: PUBLISH_ARTICLE | RETRY_PUBLICATION | SEND_CRM_WEBHOOK | CUSTOM
  ├─ payload: JSONB
  ├─ runAt: timestamp когда запускать
  ├─ status: PENDING | RUNNING | DONE | FAILED
  ├─ attempts: 0..5
  └─ nextAttemptAt: для exponential backoff

Worker tick (каждые 60s):
  1. SELECT FOR UPDATE SKIP LOCKED FROM jobs WHERE status=PENDING AND runAt <= NOW
  2. UPDATE → status=RUNNING (atomic CAS)
  3. handler[job.type](job.payload)
  4. → DONE | retry с backoff (60s → 4 мин → 16 мин → 1ч → 4ч → FAILED)

Cron sources (в порядке приоритета):
  1. instrumentation.ts через node-cron в Next-process (default)
  2. Внешний cron (Plesk / Vercel / Cloudflare) → POST /api/cron/tick с X-Cron-Secret
```

## Почему "durable"

- **Atomic CAS** через `updateMany WHERE status=PENDING` (Prisma) или `SELECT FOR UPDATE SKIP LOCKED` (raw pg) — два инстанса не возьмут одну job дважды.
- **Сохранение в БД** — рестарт сервера не теряет очередь (vs in-memory `setTimeout`).
- **Exponential backoff** — 60s → 4 мин → 16 мин → 1ч → 4ч (умножение на 4); после 5-й неудачи → `FAILED`.

## Файлы

- [`modules/scheduler/scheduler.ts`](../modules/scheduler/scheduler.ts) — `enqueue()`, `tick()`, `MAX_ATTEMPTS`, `backoff()`.
- [`modules/scheduler/api-cron-tick/route.ts`](../modules/scheduler/api-cron-tick/route.ts) — POST endpoint с `X-Cron-Secret` header.

## Установка

### 1. Schema (Prisma)

```prisma
model ScheduledJob {
  id            String   @id @default(uuid())
  type          String
  payload       Json
  status        String   @default("PENDING")  // PENDING | RUNNING | DONE | FAILED
  runAt         DateTime
  attempts      Int      @default(0)
  lastError     String?
  result        Json?
  createdAt     DateTime @default(now())
  startedAt     DateTime?
  finishedAt    DateTime?

  @@index([status, runAt])
}
```

### 2. Файлы

```bash
mkdir -p src/lib src/app/api/cron/tick
cp <dev-base>/modules/scheduler/scheduler.ts src/lib/scheduler.ts
cp <dev-base>/modules/scheduler/api-cron-tick/route.ts src/app/api/cron/tick/route.ts
```

### 3. Env

```env
CRON_SECRET=<random-32-chars>   # для авторизации внешнего cron-tick
```

### 4. Запустить worker

#### Вариант A: внутри Next-процесса через instrumentation

```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = await import('node-cron');
    const { tick } = await import('@/lib/scheduler');
    cron.schedule('* * * * *', () => tick());  // каждую минуту
  }
}
```

#### Вариант B: внешний cron (Vercel / Plesk / GH Actions)

Vercel Cron в `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/tick", "schedule": "* * * * *" }] }
```

GitHub Actions:

```yaml
on:
  schedule:
    - cron: '* * * * *'
jobs:
  tick:
    steps:
      - run: |
          curl -X POST https://yourdomain/api/cron/tick \
            -H "X-Cron-Secret: ${{ secrets.CRON_SECRET }}"
```

## Использование

### Поставить задачу в очередь

```ts
import { enqueue } from '@/lib/scheduler';

await enqueue({
  type: 'PUBLISH_ARTICLE',
  payload: { articleId: 'abc-123', platforms: ['telegram'] },
  runAt: new Date(Date.now() + 60_000),  // через минуту
});
```

### Зарегистрировать handler

В `scheduler.ts` есть `JOB_HANDLERS`:

```ts
const JOB_HANDLERS: Record<string, (payload: any) => Promise<any>> = {
  PUBLISH_ARTICLE: async (p) => publishArticle(p),
  SEND_CRM_WEBHOOK: async (p) => fetch(p.url, { method: 'POST', body: JSON.stringify(p.data) }),
  // ... добавь свои типы
};
```

### Один-раз vs recurring

`scheduler.ts` поддерживает только **one-shot**. Для recurring (например, отчёты по понедельникам):
- Добавляй handler, который **в конце** ставит следующий job: `enqueue({type: 'WEEKLY_REPORT', runAt: nextMonday()})`.
- Или используй `node-cron` напрямую для cron-выражений (нет durability, но проще).

## Подводные камни

- **MAX_ATTEMPTS = 5** — после 5-й неудачи job переходит в `FAILED` навсегда. Раз в неделю смотри `WHERE status=FAILED ORDER BY createdAt DESC` в админке (см. `SchedulerActions.tsx`).
- **Tick interval 60s** — для job'ов с `runAt < now() + 60s` лаг до выполнения. Если нужны секундные SLA — уменьши interval, но риск конкурентности увеличится.
- **Concurrency** — каждый tick берёт **одну** job (упрощение). Для batch-обработки — расширь до `LIMIT N` в SELECT.
- **Long-running handlers** — если handler выполняется > 60 сек, следующий tick может захотеть взять "висящую" RUNNING. Защита: добавь timeout `WHERE startedAt < NOW - 5 minutes` для re-claim только давно зависших.
- **Side-effect retry** — если handler уже отправил Telegram-сообщение и упал на записи БД, retry дублирует пост. Защита: idempotency на стороне handler (для publisher есть `existingSuccess` check).

## Мониторинг

```sql
-- Очередь сейчас
SELECT status, COUNT(*) FROM scheduled_jobs GROUP BY status;

-- Старые failed
SELECT * FROM scheduled_jobs WHERE status = 'FAILED' AND createdAt > NOW() - INTERVAL '7 days';

-- Аномально долгие RUNNING
SELECT * FROM scheduled_jobs WHERE status = 'RUNNING' AND startedAt < NOW() - INTERVAL '15 min';
```

## Связанные

- [`social-autopost.md`](social-autopost.md) — главный потребитель scheduler'а.
- При желании можно унести в Redis (BullMQ) — но для соло-проекта PG-based проще.
