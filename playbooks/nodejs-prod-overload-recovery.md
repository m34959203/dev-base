# Устранение перегрузки прод-сервера (PM2 + NestJS + Prisma + Postgres на 2GB VPS)

Playbook: пошаговый протокол диагностики и устранения нагрузки на маленькой проде, когда «всё тормозит / API падает / web в 502». Боевая методика, отработана на AIMAK 2026-05-09 — 1106 рестартов за 117 дней свелись к 0, RSS web 893 MB → 57 MB, 89.3% pg-времени → 0.

## Когда применять

- PM2 показывает растущий счётчик `↺` рестартов
- API возвращает 502/504 в моменты пиков
- В Postgres `Timed out fetching a new connection from the connection pool`
- В web-error.log поток `ECONNREFUSED` / `UND_ERR_SOCKET` / `read ECONNRESET`
- `free -m` показывает <100 MB free + растущий swap
- Один процесс ест >50% CPU в idle-нагрузке

## Базовый принцип

Не доверяй симптомам — их обычно несколько, наложенных друг на друга. Делай **полный snapshot** перед любым фиксом, потом **по одному фиксу** с верификацией. Иначе невозможно понять, что именно помогло.

## Шаг 1. Snapshot (5 мин, ничего не меняет)

```bash
# 1. PM2 текущее состояние
pm2 jlist > /tmp/pm2.jlist.json
pm2 list

# 2. PM2 daemon log — главный источник истины по рестартам
cp ~/.pm2/pm2.log /tmp/pm2.log.snap
grep -c "exceeds --max-memory-restart" ~/.pm2/pm2.log
grep -c "exited with code" ~/.pm2/pm2.log

# 3. Логи API/web
ls -lah /var/www/<project>/logs/
wc -l /var/www/<project>/logs/*-error.log

# 4. Системные метрики
free -m
top -bn1 -o %MEM | head -25
ps -eo pid,user,rss,vsz,etime,comm --sort=-rss | head -15
df -h /

# 5. Postgres state
sudo -u postgres psql -c "SHOW max_connections;"
sudo -u postgres psql -d <db> -c "SELECT count(*), state FROM pg_stat_activity WHERE datname='<db>' GROUP BY state;"
sudo -u postgres psql -d <db> -c "SELECT * FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY seq_scan DESC LIMIT 10;"
```

**Интерпретация:**
- `exceeds --max-memory-restart` ≫ 0 → **причина 1** (max_memory_restart)
- Pool timeout в логе → **причина 2** (pool exhaustion)
- В Postgres `idle` > `connection_limit` URL → **причина 3** (дубль PrismaClient)
- `seq_scan` > `idx_scan` на горячих таблицах → **причина 5** (нет индексов)
- RSS одного процесса > 50% RAM машины → **причина 4** (утечка / тяжёлый запрос)

## Причина 1: PM2 max_memory_restart применяется не из конфига

**Симптом:** в `ecosystem.config.js` написано `max_memory_restart: '800M'`, но в `pm2.log` значения `max_memory_limit=524288000` (= 500 MB) или другие. Процесс убивается на старом лимите.

**Почему:** PM2 хранит `max_memory_restart` (и др. process-level поля: `node_args`, `kill_timeout`, `exec_mode`) в `~/.pm2/dump.pm2`. Команды `pm2 reload`, `pm2 restart`, `pm2 reload ecosystem.config.js` **НЕ перечитывают** эти поля. Только `pm2 delete + pm2 start` пересоздаёт процесс с актуальными значениями.

**Проверка:**
```bash
pm2 jlist | python3 -c "import sys,json; o=json.load(sys.stdin); [print(a['name'], a['pm2_env'].get('max_memory_restart')) for a in o]"
# Сравнить с ecosystem.config.js * 1024 * 1024
```

**Фикс:**
```bash
pm2 save                                          # backup
pm2 delete <api> <web>
cd /var/www/<project>
pm2 start ecosystem.config.js
pm2 save                                          # новый dump
# Верификация: значение в jlist теперь совпадает с конфигом
```

⚠️ Downtime ≈ 5-10 сек на каждый процесс. Если nginx с `proxy_next_upstream` — клиент ничего не заметит.

## Причина 2: Prisma connection pool exhaustion

**Симптом:** `PrismaClientKnownRequestError: Timed out fetching a new connection from the connection pool. (limit: 5, timeout: 10)`. Часто приходит каскадом по 100-300 раз за минуту.

**Почему:** на 2GB VPS обычная рекомендация — `connection_limit=5` (чтобы не съедать 30 MB native RSS на каждый коннект). Но если запрос медленный (нет индекса, тяжёлый JSON, swap I/O), 5 коннектов с timeout 10s заклинивают за секунды под пиком.

**Фикс (минимально-инвазивный):** поднять до 10/20:
```bash
# В .env (apps/api/.env и/или root .env, оба используются Prisma)
DATABASE_URL="postgresql://...:.../<db>?connection_limit=10&pool_timeout=20"
pm2 reload <api> --update-env                    # env применяется через reload (НЕ через restart!)
```

⚠️ Перед этим проверь `max_connections` в Postgres:
```bash
sudo -u postgres psql -c "SHOW max_connections;"
# 10 коннектов API + остальные процессы должны умещаться. На VPS обычно max_connections=30, оставляй запас 2x.
```

## Причина 3: Дубль PrismaService в Nest-модулях

**Симптом:** в startup-логе **две** строки `Starting a postgresql pool with 5 connections.` и **два** `Successfully connected to database`. В `pg_stat_activity` коннектов от приложения **больше, чем `connection_limit` в URL**.

**Почему:** где-то модуль регистрирует `PrismaService` в `providers:` напрямую вместо `imports: [PrismaModule]`. Каждый такой случай создаёт **отдельный экземпляр** PrismaClient со своим пулом. На 2 пула RSS API вырастает на ~30 MB, плюс N дополнительных коннектов в Postgres.

**Поиск:**
```bash
grep -rn "PrismaService" /var/www/<project>/apps/api/src/ \
  | grep -E "providers.*\[" \
  | grep -v "// "
```

**Фикс:** заменить `providers: [PrismaService, ...]` на `imports: [PrismaModule]`:
```ts
// БЫЛО (плохо)
import { PrismaService } from '../common/prisma/prisma.service';
@Module({
  providers: [SomeService, PrismaService],  // ← создаёт второй PrismaClient
})

// СТАЛО
import { PrismaModule } from '../common/prisma/prisma.module';
@Module({
  imports: [PrismaModule],                   // ← реюзит singleton из @Global()
  providers: [SomeService],
})
```

После: `pnpm exec nest build && pm2 reload <api>`. В логе должна быть **одна** строка `Starting a postgresql pool`.

## Причина 4: Full-list endpoint без LIMIT

**Симптом:** в `pg_stat_statements` один запрос занимает 50-90% всего `total_exec_time`. В nginx access log виден ответ размером 5-20 MB. SSR-страницы Next.js делают `fetch /api/<entity>` без `?limit=`, получают всю таблицу.

**Установка pg_stat_statements (5 сек downtime БД):**
```bash
# Добавить в /etc/postgresql/<ver>/main/postgresql.conf:
echo "shared_preload_libraries = 'pg_stat_statements'" | sudo tee -a /etc/postgresql/14/main/postgresql.conf
echo "pg_stat_statements.max = 5000" | sudo tee -a /etc/postgresql/14/main/postgresql.conf
echo "pg_stat_statements.track = top" | sudo tee -a /etc/postgresql/14/main/postgresql.conf
sudo systemctl restart postgresql@14-main
sudo -u postgres psql -d <db> -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

**Топ-запросы:**
```sql
SELECT calls, round(mean_exec_time::numeric, 1) AS ms,
       round(total_exec_time::numeric, 0) AS tot_ms,
       round((100 * total_exec_time / sum(total_exec_time) OVER ())::numeric, 1) AS pct,
       left(query, 150) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname='<db>')
ORDER BY total_exec_time DESC LIMIT 10;
```

Если топ-1 — это `SELECT * FROM <table> ... OFFSET $1` без `LIMIT` → проблема. Найди вызывающие места в SSR (важно: SSR-fetch'и идут через `localhost:<api_port>`, **не через nginx**, в access.log их не видно):

```bash
grep -rn "/api/<entity>" /var/www/<project>/apps/web/src/ | head -30
```

**Фикс (backend):** в сервисе hard cap `take=100` для backward-compat ветки + `clamp` юзерского limit:
```ts
// articles.service.ts findAll()
const limit = filters?.limit && filters.limit > 0
  ? Math.min(filters.limit, 200)              // защита от ?limit=99999
  : 20;

// если каллер не передал ни page, ни limit:
return this.prisma.<entity>.findMany({
  ...
  take: 100,                                   // hard cap, защита от full-table dumps
});
```

**Фикс (frontend defense-in-depth):** в helper'е web/lib/api.ts передавать дефолтный limit всегда:
```ts
getAll: (published?: boolean, limit: number = 100) =>
  api.get('/api/<entity>', { params: { ...(published !== undefined && { published }), limit } }),
```

## Причина 5: Тяжёлые запросы без подходящего индекса

**Симптом:** в `pg_stat_user_tables` колонка `seq_scan` гораздо больше, чем `idx_scan` на горячей таблице. В EXPLAIN ANALYZE видно `Sort` без `Index Scan`.

**Поиск кандидата:**
```sql
-- какие колонки в WHERE/ORDER BY у топ-запроса?
SELECT query FROM pg_stat_statements
WHERE total_exec_time = (SELECT max(total_exec_time) FROM pg_stat_statements)
LIMIT 1;
```

**Фикс через Prisma migration (правильно — фиксируется в schema):**
```bash
# 1. Создать миграцию вручную (CREATE INDEX CONCURRENTLY НЕ работает в Prisma — там транзакция)
mkdir -p /var/www/<project>/apps/api/prisma/migrations/$(date +%Y%m%d%H%M%S)_add_<table>_<col>_idx
cat > /var/www/<project>/apps/api/prisma/migrations/.../migration.sql <<'EOF'
CREATE INDEX "<table>_<col1>_<col2>_idx" ON "<table>"("<col1>", "<col2>" DESC, "<col3>" DESC);
EOF

# 2. Добавить в schema.prisma в нужную модель:
#    @@index([col1, col2(sort: Desc), col3(sort: Desc)])

# 3. Применить
cd /var/www/<project>/apps/api
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm exec nest build
pm2 reload <api>
```

**Верификация:**
```sql
EXPLAIN (ANALYZE, BUFFERS) <тот же запрос>;
-- должна быть строка "Index Scan using <table>_<col>_idx"
```

⚠️ На таблицах <10K строк планировщик может выбрать `Seq Scan` даже при наличии индекса — это нормально (для маленькой таблицы seq scan быстрее). Индекс выстреливает на запросах **с LIMIT**.

## Причина 6: Console-spam в production

**Симптом:** web-error.log пухнет 5-30 MB/день. Большая часть — `console.log` с диагностическими сообщениями («Comparing slug X === Y», «Available slugs: [...]»).

**Фикс:**
- Найти `console.log`/`console.error` с массовым выводом:
  ```bash
  grep -rn "console\.\(log\|error\)" /var/www/<project>/apps/web/src/app/ | head -50
  ```
- Дев-логи удалить полностью. Если нужны — перевести в `if (process.env.NODE_ENV !== 'production') console.log(...)`.
- Если ошибка не критична (есть fallback) — `console.warn` или `console.debug` вместо `console.error`.

## Шаг X. Error Boundary как safety-net (Next.js)

Не лечит причину, но превращает любой runtime error в красивую страницу вместо 500:

```tsx
// apps/web/src/app/<lang>/error.tsx
'use client';
export default function ErrorBoundary({ error, reset }) {
  useEffect(() => { console.error(error); }, [error]);
  return <div>... fallback UI с кнопкой reset() ...</div>;
}
```

После добавления требует `pnpm --filter web build`. На 2GB VPS перед билдом:
```bash
pm2 stop <web>                                    # освободит ~400 MB
NODE_OPTIONS="--max-old-space-size=900" pnpm --filter web build
pm2 start <web>
```

## Шаг финальный. Верификация

```bash
# 1. Сброс счётчиков pg_stat_statements (чтобы видеть только период после фиксов)
sudo -u postgres psql -d <db> -c "SELECT pg_stat_statements_reset();"

# 2. Сброс PM2 restart counters
pm2 reset <api>
pm2 reset <web>
pm2 save

# 3. Flush логов (старое в ротированных файлах останется)
pm2 flush <api>
pm2 flush <web>

# 4. Через 30-60 минут проверить:
pm2 jlist | python3 -c "import sys,json; o=json.load(sys.stdin); [print(a['name'], 'restart=', a['pm2_env'].get('restart_time')) for a in o]"
sudo -u postgres psql -d <db> -c "SELECT calls, mean_exec_time, left(query, 80) FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 5;"
wc -l /var/www/<project>/logs/*-error.log
```

Цели после фиксов:
- `restart_time` не растёт
- В топ-1 `pg_stat_statements` нет full-list dump
- `*-error.log` накапливает <100 строк/час
- `free -m` показывает available > 500 MB при пиковой нагрузке

## Бэкапы перед каждым фиксом

```bash
# Конфиги:    cp <file> <file>.bak.$(date +%s)
# Postgres:   sudo -u postgres pg_dump <db> > /tmp/<db>.$(date +%Y%m%d_%H%M).sql.gz
# PM2 dump:   pm2 save  # автоматически бэкапит ~/.pm2/dump.pm2.bak
```

## Связанные плейбуки

- [cloudflare-ssr-cache.md](cloudflare-ssr-cache.md) — следующий уровень: вынести 40-60% запросов на CF edge cache
- [server-port-isolation.md](server-port-isolation.md) — карта портов для multi-tenant VPS
- [analytics-stack.md](analytics-stack.md) — observability и метрики

## Источник

Боевой кейс AIMAK (aimaqaqshamy.kz) на 1.9 GB VPS, 2026-05-09. См. memo `feedback_pm2_max_memory_dump.md` и `project_aimak.md` в личной памяти Claude.
