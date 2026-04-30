# Playbook: стиль SQL-миграций (numbered, idempotent, bilingual-aware)

**Источник:** til-kural `sql/001…011`, dvorets-gornyakov `sql/001…013`, smart-kids-library `sql/001…007` — стихийно стандартизированный стиль во всех проектах.

## Конвенции

### Имена файлов

```
sql/
├── 001_init.sql
├── 002_<feature>.sql
├── 003_<feature>.sql
├── ...
├── 010_refresh_tokens.sql
├── 011_ai_usage.sql
└── 099_seed_<thing>.sql      ← seeds в 0xx-диапазоне
```

- Префикс — 3-значный номер с лидирующими нулями.
- Имя — `kebab_case` или `snake_case` от темы миграции.
- Seeds (наполнение справочников) — отдельно в `09x` или `099_seed_*`.

### Идемпотентность

Все DDL операторы используют `IF NOT EXISTS`:

```sql
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
```

Это позволяет:
- Применить миграцию дважды без ошибки.
- Использовать `psql -f` напрямую без миграционной системы (Prisma, Sequelize, Alembic).
- При первом запуске в Docker compose `initdb` отыграть весь набор.

### Шапка файла

```sql
-- 011: ai_generations — журнал AI-вызовов для квотного гарда и расчёта расхода.
-- Каждая Gemini-операция (chat/vision/tts/exercises) пишет сюда строку. На входе
-- assertQuota() читает агрегаты за 60с и 24ч и блокирует на 90% free-tier лимита.
```

В первом комментарии — **что** и **зачем**, не *как*. «Зачем» полезнее при чтении через год.

### Primary keys

Всегда UUID v4:

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- один раз в 001_init

CREATE TABLE thing (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ...
);
```

Не использовать `SERIAL`/`BIGSERIAL` (предсказуемые ID, которые легко перебрать в URL).

### Foreign keys

ВСЕГДА с явной `ON DELETE` policy:

```sql
author_id UUID REFERENCES users(id) ON DELETE SET NULL,    -- автор может уйти, статья остаётся
order_id UUID REFERENCES orders(id) ON DELETE CASCADE,     -- удаление заказа убивает позиции
parent_id UUID REFERENCES categories(id) ON DELETE RESTRICT, -- запрет удаления родительской категории с детьми
```

`RESTRICT` (default) запрещает любую логику и валит deploy — почти никогда не то, что хочется.

### Двуязычные поля

```sql
title_kk VARCHAR(500) NOT NULL,
title_ru VARCHAR(500) NOT NULL,
content_kk TEXT NOT NULL,
content_ru TEXT NOT NULL,
```

**Локали в коде:** ISO-правильно — `kk` (казахский), `ru`. **НЕ `kz`**.

Helper для чтения по локали:

```ts
function getLocalizedField<T>(row: T, field: string, locale: 'kk' | 'ru'): string {
  return row[`${field}_${locale}`] ?? row[`${field}_ru`] ?? '';
}
```

### Timestamps

```sql
created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
```

**Всегда WITH TIME ZONE** — иначе при работе с UTC сервером и Astana-клиентами расходимся на 5 часов.

`updated_at` авто-обновляется триггером (опционально):

```sql
CREATE OR REPLACE FUNCTION trigger_set_timestamp() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp BEFORE UPDATE ON news
  FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
```

### Индексы

Имя — `idx_<table>_<columns>`:

```sql
CREATE INDEX IF NOT EXISTS idx_news_status_published ON news(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_slug ON news(slug);
CREATE INDEX IF NOT EXISTS idx_news_scheduled ON news(scheduled_at) WHERE status = 'scheduled';
```

**Partial index** (`WHERE`-clause) для редких статусов: только опубликованные / только драфты — экономит место и ускоряет.

### CHECK constraints для enum-полей

Вместо PG-enum типа (тяжело мигрировать):

```sql
status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'editor', 'moderator')),
language_level VARCHAR(5) CHECK (language_level IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
```

Менять значения легко: просто новая миграция с DROP + ADD constraint (если используете PG enum, нужны хитрые `ALTER TYPE`).

## Шаблон миграции

См. [`templates/sql/000_init_template.sql`](../templates/sql/000_init_template.sql) — копируется в `sql/001_init.sql` и адаптируется.

Готовые миграции:
- [`templates/sql/ai_generations.sql`](../templates/sql/ai_generations.sql) — лог AI-вызовов
- [`templates/sql/refresh_tokens.sql`](../templates/sql/refresh_tokens.sql) — refresh-token таблица для JWT auth

## Применение

### Через psql (raw):

```bash
for f in sql/*.sql; do psql $DATABASE_URL -f "$f"; done
```

### Через docker-compose initdb (первый запуск):

```yaml
services:
  db:
    image: postgres:16-alpine
    volumes:
      - ./sql:/docker-entrypoint-initdb.d:ro
```

При **первом** запуске postgres-контейнера прогоняет все `*.sql` из этой папки в алфавитном порядке. На последующих стартах — нет.

### Через Prisma:

Если используешь Prisma, вместо raw SQL — `prisma/schema.prisma` + `npx prisma migrate dev --name <name>`. Prisma сама раскладывает в `prisma/migrations/<timestamp>_<name>/migration.sql`.

## Подводные камни

- **Не нумеруй `001`, `002` вручную если N+1 разработчиков** — будут конфликты merge. Используй timestamp-based naming (`20260430_init`, `20260501_add_field`) или Prisma migrate.
- **`IF NOT EXISTS` имеет ограничения** — в PG нет `IF EXISTS` для `ALTER TABLE ... ADD COLUMN` до PG 9.6 (всё ОК с PG 16). Для `DROP COLUMN IF EXISTS` — да, ок.
- **Migration ordering** — `psql -f sql/*.sql` применяет в shell-glob порядке; убедись, что 1, 2, ..., 10, 11 (а не 1, 10, 11, 2). Поэтому 3-значный номер обязателен.
- **Concurrency на проде** — `CREATE INDEX CONCURRENTLY` (без `IF NOT EXISTS`) если индекс на большой таблице. Иначе блокировка пишущих.
- **`uuid_generate_v4()` vs `gen_random_uuid()`** — последний (PG 13+) не требует extension. Можно использовать вместо uuid-ossp.

## Связанные

- [`templates/sql/`](../templates/sql/) — готовые куски (ai_generations, refresh_tokens, init).
- [`playbooks/auth-jwt-refresh.md`](auth-jwt-refresh.md) — использует `refresh_tokens`.
- [`playbooks/ai-quota-guard.md`](ai-quota-guard.md) — использует `ai_generations`.
