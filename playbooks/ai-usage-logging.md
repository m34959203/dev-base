# Логирование AI usage в БД (Gemini / Groq) — статистика без circular DI

Playbook: добавить статистику AI-вызовов (provider, model, operation, tokens, latency, success/fail, user) в существующий NestJS+Prisma проект, не ломая static utility и не делая циклических зависимостей. Боевой кейс — AIMAK 2026-05-09 (commit `345dd0b`).

## Когда применять

- В проде уже работает AI (Gemini/OpenAI/Groq/Anthropic) — **не хочется переписывать вызовы** в 5+ сервисах
- Нужна статистика для админки: сколько вызовов, токены, стоимость, кто из админов жжёт лимит
- Свободного бюджета на пакеты типа `langfuse` / `helicone` / `posthog` нет — обходимся своей таблицей
- На 2GB VPS — лишних сервисов и очередей не подключать; insert в Postgres достаточно

## Архитектурная схема

```
                  ┌─────────────────────┐
   AI request ──→ │ static utility/SDK  │ ──→ usage callback
                  │ (GeminiRetryUtil)   │            │
                  └─────────────────────┘            ▼
                                            ┌────────────────┐
   bootstrap   ──→ AiUsageService.set ─────→│  bridge (static│
                                            │ field)         │
                                            └────────────────┘
                                                    │
                                                    ▼
                                       prisma.aiUsageLog.create
                                            (fire-and-forget)
```

**Ключевая идея:** static utility не может injectionить `PrismaService` (нет DI у класса с одними static методами). Прямой импорт PrismaService в utility создаёт circular import. Решение — **bridge через static setter**: injectable service на `onModuleInit` регистрирует callback в utility, дальше utility вызывает его как обычную функцию.

Это не «правильный» NestJS-паттерн — но он минимизирует правки в существующем коде (не нужно превращать `XyzUtil` в `XyzService` и менять все callers).

## Шаг 1. Prisma schema + migration

```prisma
// prisma/schema.prisma
model AiUsageLog {
  id               String   @id @default(uuid())
  createdAt        DateTime @default(now()) @map("created_at")
  provider         String   // 'gemini' | 'groq' | 'openai' | ...
  model            String
  operation        String?  // 'translation' | 'tags-generation' | 'categorization' | ...
  promptTokens     Int?     @map("prompt_tokens")
  completionTokens Int?     @map("completion_tokens")
  totalTokens      Int?     @map("total_tokens")
  latencyMs        Int      @map("latency_ms")
  success          Boolean
  errorMessage     String?  @map("error_message")
  userId           String?  @map("user_id")
  user             User?    @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@map("ai_usage_log")
  @@index([createdAt])
  @@index([provider, createdAt])
  @@index([operation])
}

// + в model User добавить:
//   aiUsageLogs     AiUsageLog[]
```

Migration вручную (если `prisma migrate dev` не доступен на проде):

```sql
CREATE TABLE "ai_usage_log" (
  "id" TEXT PRIMARY KEY,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" TEXT,
  "prompt_tokens" INTEGER,
  "completion_tokens" INTEGER,
  "total_tokens" INTEGER,
  "latency_ms" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "error_message" TEXT,
  "user_id" TEXT REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ai_usage_log_created_at_idx" ON "ai_usage_log"("created_at" DESC);
CREATE INDEX "ai_usage_log_provider_created_at_idx" ON "ai_usage_log"("provider", "created_at" DESC);
CREATE INDEX "ai_usage_log_operation_idx" ON "ai_usage_log"("operation");
```

Apply: `pnpm exec prisma migrate deploy && pnpm exec prisma generate`.

## Шаг 2. AiUsageService (Injectable, @Global)

```ts
// src/ai-usage/ai-usage.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { GeminiRetryUtil } from '../common/utils/gemini-retry.util';

@Injectable()
export class AiUsageService implements OnModuleInit {
  private readonly logger = new Logger(AiUsageService.name);
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    GeminiRetryUtil.setUsageLogger((data) => this.log(data));
    this.logger.log('AI usage logger bridged into GeminiRetryUtil');
  }

  log(record: AiUsageRecord): void {
    // fire-and-forget — никогда не throw, AI-вызов важнее метрики
    this.prisma.aiUsageLog.create({ data: { ...record } })
      .catch((err) => this.logger.warn(`log failed: ${err.message}`));
  }

  async getStats(filters: { from?, to?, provider?, operation? }) {
    // Promise.all с count, aggregate, groupBy(provider/operation/model), $queryRawUnsafe(by day)
    // → возвращаем { summary, byProvider, byOperation, byModel, byDay }
  }

  async getRecent(limit = 100) {
    return this.prisma.aiUsageLog.findMany({
      take: Math.min(Math.max(limit, 1), 500),
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
  }
}
```

```ts
// src/ai-usage/ai-usage.module.ts
@Global()
@Module({
  providers: [AiUsageService],
  controllers: [AiUsageController],
  exports: [AiUsageService],
})
export class AiUsageModule {}
```

```ts
// src/ai-usage/ai-usage.controller.ts
@Controller('admin/ai-usage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.EDITOR)
export class AiUsageController {
  constructor(private readonly aiUsage: AiUsageService) {}
  @Get('stats')   getStats(@Query() q) { ... }
  @Get('recent')  getRecent(@Query('limit') l) { ... }
}
```

Импорт в `app.module.ts` рядом с другими модулями.

## Шаг 3. Bridge в static utility

```ts
// src/common/utils/gemini-retry.util.ts (или ваш AI-helper)
export interface AiUsageLogData {
  provider: 'gemini' | 'groq';
  model: string;
  operation?: string;
  userId?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  success: boolean;
  errorMessage?: string;
}

export class GeminiRetryUtil {
  // Bridge — заполняется AiUsageService на bootstrap
  private static usageLogger: ((data: AiUsageLogData) => void) | null = null;

  static setUsageLogger(fn: ((data: AiUsageLogData) => void) | null): void {
    this.usageLogger = fn;
  }

  private static logUsage(data: AiUsageLogData): void {
    try { this.usageLogger?.(data); } catch { /* never throw from logger */ }
  }

  static async executeWithRetry(options, retryOptions = {}) {
    const startedAt = Date.now();
    // ...existing logic...

    // SUCCESS path:
    this.logUsage({
      provider: 'gemini', model, operation: options.operation, userId: options.userId,
      latencyMs: Date.now() - startedAt,
      promptTokens: response.usageMetadata?.promptTokenCount,
      completionTokens: response.usageMetadata?.candidatesTokenCount,
      totalTokens: response.usageMetadata?.totalTokenCount,
      success: true,
    });
    return result;

    // FINAL FAIL path (после всех retries):
    this.logUsage({
      provider: 'gemini', model, operation: options.operation, userId: options.userId,
      latencyMs: Date.now() - startedAt,
      success: false,
      errorMessage: error.message,
    });
    this.handleGeminiError(error); // throws
  }
}
```

Также добавить `operation?: string; userId?: string;` в `GeminiRequestOptions`.

## Шаг 4. Передавать `operation` из вызывающих сервисов

Самый простой sed-патч (ищет существующую строку `prompt,` внутри `executeWithRetry({...`):

```bash
sed -i "/^          prompt,$/a\\          operation: 'translation'," \
  src/translation/translation.service.ts
sed -i "/^          prompt,$/a\\          operation: 'tags-generation'," \
  src/tags/tags.service.ts
sed -i "/^          prompt,$/a\\          operation: 'categorization'," \
  src/articles/article-categorization.service.ts
```

⚠️ Sed не сработает если в коде разные отступы или вложенный prompt. Проверить `grep -c 'operation:' <file>` перед/после.

## Шаг 5. Admin UI

Простая страница `apps/web/src/app/admin/statistics/ai/page.tsx` — без recharts, чистым CSS:

- 4 summary-карточки (totalCalls / successRate / totalTokens / avgLatency)
- 3 bar-блока (by provider / by operation / by model) — `<div style={{ width: ${value/max*100}%}} />`
- 1 bar по дням (последние 30)
- Таблица последних 100 — полная с user info через FK
- Фильтр периода: 24h / 7d / 30d / all

React Query с `refetchInterval: 60_000` для авто-апдейта.

## Шаг 6. Smoke + verify

После build/reload:
1. `tail logs/api-out.log | grep "logger bridged"` — должен быть лог `AI usage logger bridged into GeminiRetryUtil`
2. `Routes /api/admin/ai-usage/{stats,recent}` зарегистрированы
3. `/api/admin/ai-usage/stats` без auth → **401** (auth-gate работает)
4. Сделать реальный AI-вызов через админку (translation/categorize) → проверить:
   ```sql
   SELECT count(*), provider, operation FROM ai_usage_log GROUP BY provider, operation;
   ```
5. Открыть `/admin/statistics/ai` — данные должны появиться

## Подводные камни

- **Не делать `await` на log()** — добавит +5-20ms latency к каждому AI-вызову. Fire-and-forget через `.catch(() => {})` достаточно. Если БД упадёт — записи потеряются, но AI-вызов пройдёт.
- **Не использовать `Logger` для записи в файл вместо БД** — на проде ротация логов схлопнет старые данные, метрики будут обрезаны. Только БД с явной ретенцией (например `DELETE FROM ai_usage_log WHERE created_at < NOW() - INTERVAL '90 days'` через cron).
- **Не логировать сам prompt и response.text** — может содержать PII. Если очень нужно для debug — отдельная таблица `ai_usage_payload` с TTL и доступом только для root.
- **`gemini-2.0-flash-lite` deprecated Google'ом** — если вдруг настраивали проект до моей правки, использует мёртвую модель. Заменить на `gemini-flash-lite-latest`.
- **На больших объёмах** (>1k вызовов/мин) — переводить запись в очередь (Bull/PG queue) чтобы insert не блокировал event loop.

## Связанные плейбуки

- [ai-quota-guard.md](ai-quota-guard.md) — pre-flight USD/quota cap, чтобы не вылететь в платный тариф
- [analytics-stack.md](analytics-stack.md) — общий паттерн: consent + event store + dashboard
- [nodejs-prod-overload-recovery.md](nodejs-prod-overload-recovery.md) — фиксы перегрузки сервера, если AI-нагрузка станет ботлнеком

## Источник

AIMAK (aimaqaqshamy.kz), commit `345dd0b` от 2026-05-09. См. memo `feedback_gemini_lite_deprecated.md` и `project_aimak.md` в личной памяти.
