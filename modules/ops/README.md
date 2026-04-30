# modules/ops/

Operations scripts: backup / restore / healthcheck / secret rotation. Production-tested на сервере technokod.

## Файлы

- [`healthcheck.sh`](healthcheck.sh) — проверяет docker container + DB + HTTP `/api/health`. Можно поставить в cron каждые 5 мин с алертом в Telegram при failure.
- [`pg-backup.sh`](pg-backup.sh) — `pg_dump` → gzip → загрузка в S3/локально с timestamp в имени. По умолчанию хранит 14 дней, старше — удаляет.
- [`pg-restore.sh`](pg-restore.sh) — обратная операция: скачать → gunzip → `psql -f`.
- [`rotate-secrets.sh`](rotate-secrets.sh) — атомарная ротация AUTH_SECRET / CRON_SECRET / METRICS_TOKEN / SOCIAL_ENCRYPTION_KEY через mktemp/sed. Генерирует новые через `openssl rand -base64 32`, обновляет .env, делает `docker compose restart`. Сохраняет старые в `.env.bak.<timestamp>` на 7 дней (для отката).

## Связанный CI

- [`modules/ci/db-backup.yml`](../ci/db-backup.yml) — GitHub Actions cron `'17 3 * * *'` (03:17 UTC ежедневно):
  - SSH в production через `webfactory/ssh-agent@v0.9.0`
  - Запускает `pg-backup.sh`
  - Загружает в S3
  - Чистит старше 14 дней
  - Уведомляет в Telegram on success/failure
  
  Требует secrets: `SSH_PRIVATE_KEY`, `SSH_HOST`, `S3_BUCKET`, `AWS_KEY`, `AWS_SECRET`, `TG_BOT_TOKEN`, `TG_CHAT_ID`.

## Использование

### Локально (на сервере) — backup сейчас

```bash
chmod +x modules/ops/*.sh
DATABASE_URL=postgres://... bash modules/ops/pg-backup.sh
```

### Восстановить из backup

```bash
bash modules/ops/pg-restore.sh /var/backups/db-2026-04-30.sql.gz
```

### Healthcheck cron

```bash
# /etc/cron.d/healthcheck-app
*/5 * * * * ubuntu /home/ubuntu/yourapp/scripts/healthcheck.sh || /usr/local/bin/notify-tg "Health check failed for yourapp"
```

### Ротация секретов

```bash
# Один раз в 90 дней или при подозрении на компрометацию
bash modules/ops/rotate-secrets.sh
# → генерит новые AUTH_SECRET / CRON_SECRET / METRICS_TOKEN / SOCIAL_ENCRYPTION_KEY
# → обновляет .env (сохраняет .env.bak.<timestamp>)
# → docker compose restart app
# → ВНИМАНИЕ: при ротации SOCIAL_ENCRYPTION_KEY все credentials в БД нужно re-encrypt!
```

## Подводные камни

- **`pg-backup.sh`** требует `pg_dump` той же версии, что PG-сервер. Иначе несовместимость dumps.
- **`rotate-secrets.sh`** — после ротации `SOCIAL_ENCRYPTION_KEY` нужен скрипт re-encrypt (читать старым, писать новым). В technokod это руками; стоит автоматизировать.
- **S3 backup** — храни bucket в **другом регионе** чем продакшн. Иначе при катастрофе региона теряешь и DB, и backup.
- **Healthcheck в cron** — добавь `flock` или lockfile, иначе при долгом таймауте запускаются параллельные.
- **DB-backup encryption** — для PII-данных gzip недостаточно; шифруй через `gpg --encrypt` перед S3.

## Связанные

- [`playbooks/db-backup-restore.md`](../../playbooks/db-backup-restore.md) — пошаговый сценарий (TBD).
