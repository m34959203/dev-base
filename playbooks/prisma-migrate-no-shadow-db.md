# Prisma migrate без shadow-БД на проде

Playbook: на production-PostgreSQL у пользователя нет CREATE DATABASE прав, `prisma migrate dev` падает с `P3014`. Боевой кейс — AIMAK 2026-05-10, миграция `add_focal_point` (Int? focalX/focalY в Article).

## Когда применять

- На проде/staging запустил `npx prisma migrate dev --name <name>`
- Получил ошибку:
  ```
  Error: P3014
  Prisma Migrate could not create the shadow database.
  ERROR: permission denied to create database
  ```
- В `dev` локально та же команда работает (пользователь postgres имеет полные права)

## Корневая причина

`prisma migrate dev` создаёт **временную shadow-БД** для:
1. Применить все существующие миграции на чистую БД.
2. Сделать diff против текущей `schema.prisma`.
3. Сгенерировать `migration.sql`.
4. Применить миграцию на основной БД.

На managed-postgres (Hoster.kz, Supabase, RDS, DigitalOcean managed, Neon free tier) **GRANT CREATE ON DATABASE** обычно отсутствует у обычного user-роли — это правильная безопасность. Но Prisma ломает workflow.

## Решение — ручная SQL миграция + `migrate resolve`

### 1. Сгенерировать `migration.sql` руками

Допустим в `schema.prisma` добавили:

```prisma
model Article {
  // ...
  focalX  Int?  @map("focal_x")
  focalY  Int?  @map("focal_y")
}
```

Положить миграцию вручную:

```bash
TS=$(date +%Y%m%d%H%M%S)
NAME=add_focal_point
mkdir -p prisma/migrations/${TS}_${NAME}
cat > prisma/migrations/${TS}_${NAME}/migration.sql <<'SQL'
-- AlterTable
ALTER TABLE "articles" ADD COLUMN "focal_x" INTEGER;
ALTER TABLE "articles" ADD COLUMN "focal_y" INTEGER;
SQL
```

Формат имени директории `<timestamp>_<name>` — Prisma его требует. Timestamp должен быть **позже** последней существующей миграции, иначе Prisma сочтёт её out-of-order.

### 2. Применить SQL директно

```bash
psql -U <db-user> -h localhost -d <db-name> -f prisma/migrations/${TS}_${NAME}/migration.sql
```

(или через `prisma db execute --stdin` если PostgreSQL клиент не установлен).

### 3. Отметить миграцию как применённую

Чтобы будущие `prisma migrate deploy` не пытались её прокатить ещё раз:

```bash
DATABASE_URL="postgresql://..." \
  npx prisma migrate resolve --applied ${TS}_${NAME}
```

Это просто insert в служебную таблицу `_prisma_migrations` — без выполнения SQL.

### 4. Обновить Prisma client

```bash
npx prisma generate
```

Без shadow-БД, без даунтайма, типы в коде сразу обновятся.

## Чек-лист после миграции

- `psql ... -c "\d articles" | grep focal` — колонки реально есть
- `prisma migrate status` — нет «pending» миграций
- API возвращает новые поля без рестарта (если Prisma client пере-сгенерирован)
- Запушить migration.sql в git вместе с обновлением schema.prisma

## Когда НЕ применять

- В `dev` локально с правами CREATE DATABASE — обычный `prisma migrate dev` работает быстрее.
- Когда нужно автоматизировать миграции в CI/CD — настроить отдельный shadow-DB-пользователя с правами, или использовать `prisma migrate deploy` (он не нуждается в shadow-БД, применяет уже существующие migrations.sql).

## Альтернативные подходы

- **`prisma db push`** — синхронизирует схему без создания migration.sql. Подходит для dev, **не годится для prod** (нет истории, нет rollback).
- **Atlas / sqitch / dbmate** — отдельные инструменты для миграций. Если уже на Prisma — менять стек ради одной фичи дорого.

## Связанные кейсы

- AIMAK 2026-05-10 (commit `039e87b`) — миграция `add_focal_point` через ALTER TABLE + `migrate resolve --applied`
- ZhezU/LoadCalc и любой managed-PG-проект — тот же паттерн
