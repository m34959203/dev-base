# Cloudflare Free 100s — батчить из фронта вместо async job

Playbook: что делать когда long-running admin-endpoint (массовая AI-обработка, миграция, перевод) падает с **524 Bad Gateway** через Cloudflare Free. Боевой кейс — AIMAK 2026-05-09, batch-категоризация 1816 статей.

## Когда применять

- В браузере консоль показывает `524` на POST/GET к `/api/...`
- Endpoint работает дольше **~100 секунд** (типичный AI-batch, миграция, image-resize пакетом)
- Между клиентом и origin стоит Cloudflare (Free или Pro)
- Не хочется (или нет ресурсов) поднимать Redis/Bull для async job-pattern

## Корневая причина

**Cloudflare Free** имеет жёсткий лимит **100 секунд** на backend response. **CF Pro** — тот же 100s. Только **Enterprise** позволяет настроить до 6000s через панель.

Это **не лечится**:
- ❌ `proxy_read_timeout 600s` в nginx
- ❌ Page Rule «Cache Level: Bypass»
- ❌ Disable Rocket Loader / Performance settings
- ❌ HTTP/2 keep-alive

CF разрывает соединение **независимо от origin**. Origin может обрабатывать в фоне ещё 5 минут — клиент уже получил 524.

## Решение — батчить (4 кирпича)

### 1. Idempotency-метка на сущности

Чтобы не пересчитывать одно и то же при повторных батчах:

```prisma
model Article {
  // ...
  aiCategorizedAt DateTime? @map("ai_categorized_at")
  @@index([aiCategorizedAt])
}
```

```sql
-- migration.sql
ALTER TABLE "articles" ADD COLUMN "ai_categorized_at" TIMESTAMP(3);
CREATE INDEX "articles_ai_categorized_at_idx" ON "articles"("ai_categorized_at");
```

⚠️ **Метка ставится ПОСЛЕ КАЖДОЙ ПОПЫТКИ** (success/skipped/error), не только success. Иначе кривая запись (например AI вернул несуществующий slug) висит в очереди вечно.

### 2. Backend endpoint принимает `limit` и возвращает `remaining`

```ts
@Post('categorize-all')
async categorizeAllArticles(
  @Query('limit') limitStr?: string,
  @Query('force') forceStr?: string,
) {
  const limit = Math.min(Math.max(parseInt(limitStr ?? '10', 10), 1), 10);
  const force = forceStr === 'true';

  const where = force ? {} : { aiCategorizedAt: null };
  const remainingBeforeBatch = await this.prisma.article.count({ where });

  if (remainingBeforeBatch === 0) {
    return { success: true, message: 'Все обработаны', stats: { total: 0, ..., remaining: 0 } };
  }

  const articles = await this.prisma.article.findMany({ where, take: limit, ... });

  let updated = 0, skipped = 0, errors = 0;
  for (const article of articles) {
    try {
      const result = await this.processOne(article);
      await this.prisma.article.update({
        where: { id: article.id },
        data: { aiCategorizedAt: new Date(), ...result },
      });
      updated++;
    } catch (e) {
      // Метим даже на ошибке — иначе бесконечно висит
      await this.prisma.article.update({
        where: { id: article.id },
        data: { aiCategorizedAt: new Date() },
      }).catch(() => {});
      errors++;
    }
    await new Promise((r) => setTimeout(r, 500)); // rate-limit pause
  }

  return {
    success: true,
    stats: {
      total: articles.length,
      updated, skipped, errors,
      remaining: Math.max(0, remainingBeforeBatch - articles.length),
    },
  };
}
```

### 3. Расчёт `limit`

Целевое окно — **80с** (буфер 20с против CF 100s):

| Время на единицу | Безопасный limit |
|---|---|
| 2-3s (только Gemini, без retries) | **20-25** |
| 5-7s (Gemini + 500ms pause) | **10-12** |
| 8-10s (Groq fallback или retry) | **5-8** |
| 15s+ | переходить на async job |

В AIMAK: Groq часто падал → Gemini fallback ~7-9с/статью → default `limit=10`.

### 4. Frontend цикл с прогресс-баром и Cancel

```tsx
'use client';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function BatchProcessor({ apiCall }) {
  const [progress, setProgress] = useState(null);
  const cancelRef = useRef(false);
  const queryClient = useQueryClient();

  const start = async () => {
    if (!confirm('Запустить?')) return;
    setProgress({ running: true, total: 0, processed: 0, updated: 0, errors: 0 });
    cancelRef.current = false;
    const agg = { processed: 0, updated: 0, errors: 0 };
    let total = 0;

    try {
      while (!cancelRef.current) {
        const res = await apiCall({ limit: 10 });
        const stats = res.data.stats;
        if (stats.total === 0) break;
        agg.processed += stats.total;
        agg.updated += stats.updated;
        agg.errors += stats.errors;
        total = agg.processed + stats.remaining;
        setProgress({ running: true, total, ...agg });
        if (stats.remaining === 0) break;
      }
      queryClient.invalidateQueries({ queryKey: ['articles'] });
      alert(`Готово: ${agg.updated}/${agg.processed}, ошибок ${agg.errors}`);
    } catch (e) {
      alert(`Ошибка после ${agg.processed} обработанных: ${e.message}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <button onClick={start}>Запустить</button>
      {progress?.running && (
        <div className="fixed bottom-4 right-4 bg-white shadow-2xl rounded-xl p-4 w-80 z-50">
          <div className="flex justify-between mb-2">
            <span className="font-semibold">Обработка...</span>
            <button onClick={() => { cancelRef.current = true; }}>Стоп</button>
          </div>
          <div className="text-xs text-gray-600">
            {progress.processed} / {progress.total} · ✓{progress.updated} ✗{progress.errors}
          </div>
          <div className="h-1.5 bg-gray-100 rounded mt-2">
            <div
              className="h-full bg-purple-500 rounded transition-all"
              style={{ width: `${(progress.processed / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
        </div>
      )}
    </>
  );
}
```

⚠️ Cancel не прерывает текущий batch (Promise.all уже стартовал). Текущие 10 единиц доделают и пометят `aiCategorizedAt`. После этого цикл выйдет.

## Не забывайте

- **Axios timeout**: `axios.post(url, body, { timeout: 120_000 })` — иначе клиент сам обрубит на 30с-default. Нужен буфер выше CF cap.
- **`force=true`** для повторной обработки — иначе после первого прохода метка везде стоит и endpoint всегда возвращает `remaining: 0`.
- **Логирование fail-cases**: invalid slug / AI вернул мусор → `console.warn`, не `console.error`. Ошибка категоризации — это не падение системы.
- **React Query `invalidateQueries`** в конце цикла — чтобы UI таблицы статей подтянул новые данные.

## Альтернативы (если batch не подходит)

| Вариант | Сложность | Когда применять |
|---|---|---|
| **Batch (этот плейбук)** | низкая | до 10000 единиц, разовая операция от админа |
| **Async job + polling** | средняя | долгие задачи (часы), множество одновременных юзеров |
| **Cloudflared Tunnel напрямую** | низкая | если есть отдельный subdomain без CF (`api.example.com`) |
| **Cloudflare Pro** | низкая, $20/мес | если 100s одинаково давит на все endpoints |
| **Background worker (Bull/Redis)** | высокая | масштабная обработка (миллионы), retries, scheduling |

## Связанные плейбуки

- [ai-usage-logging.md](ai-usage-logging.md) — bridge для AI-метрик из static utility
- [nodejs-prod-overload-recovery.md](nodejs-prod-overload-recovery.md) — диагностика перегрузки сервера

## Источник

AIMAK (aimaqaqshamy.kz), commit `be685e9` от 2026-05-09. См. memo `feedback_cf_free_100s.md` и `project_aimak.md` в личной памяти Claude.
