# Playbook: Deploy Next.js → Plesk через GitHub Actions FTP

**Кейс:** Hoster.kz Plesk-домен (или любой Plesk с FTP-доступом). Boilerplate-cтэк: Next.js 16 → `.next/` (без standalone, runtime через nodejs.app в Plesk).

**Источник:** `vestnik-frontend` (vestnik.zhezu.kz), production с 2025-11.

## Зачем

Hoster.kz и большинство Plesk-хостингов в KZ/СНГ **не поддерживают git pull / docker / GHCR** на shared-тарифах. Единственный путь автодеплоя — **FTP** + ручное `touch tmp/restart.txt` (Plesk сам перезапустит nodejs-процесс).

Проблемы при наивном rsync/lftp подходе:
1. **ProFTPD банит data-port после ~363 быстрых STOR** → blue-green деплой в `.next.new/` ломается на 1900+ файлах. Решение: одиночная цель + cache-wipe.
2. **Standalone-режим** Next.js дублирует runtime — `.next/standalone/` = ещё ~50 МБ, провоцирует ECONNRESET и не нужен (Plesk уже даёт node_modules). Решение: исключать `cache,dev,trace,diagnostics,standalone` из upload.

## Файлы

- [`modules/ci/deploy-plesk-ftp.yml`](../modules/ci/deploy-plesk-ftp.yml) — GitHub Actions workflow
- [`modules/scripts/ftp_upload_next.py`](../modules/scripts/ftp_upload_next.py) — Python uploader через `ftplib`

## Установка в новый проект

### 1. Положить файлы

```bash
mkdir -p .github/workflows scripts
cp <dev-base>/modules/ci/deploy-plesk-ftp.yml .github/workflows/deploy.yml
cp <dev-base>/modules/scripts/ftp_upload_next.py scripts/
```

### 2. Прописать секреты в GitHub

`Settings → Secrets and variables → Actions → New repository secret`:

| Секрет | Что | Пример |
|---|---|---|
| `FTP_PASS` | Пароль FTP-юзера | `••••••••` |
| `OJS_API_URL` / любые свои env | Если нужны на билде | `https://api.example.com` |

### 3. Прописать переменные в workflow

В `deploy-plesk-ftp.yml` под `env:` шага «Deploy»:

```yaml
env:
  FTP_PASS: ${{ secrets.FTP_PASS }}
  FTP_HOST: 89.35.125.17       # IP или hostname FTP-сервера Plesk
  FTP_USER: yourdomain_kz      # FTP-юзер из Plesk → Hosting Settings
  REMOTE_ROOT: /yourdomain.kz  # путь на сервере (обычно совпадает с доменом)
  NEXT_DEPLOY_EXCLUDE_TOP: cache,dev,trace,diagnostics,standalone
```

### 4. Smoke-check после деплоя

В конце workflow `curl` главной страницы и одного важного маршрута:

```yaml
- name: Smoke check
  run: |
    sleep 8
    curl -sk -o /dev/null -w "/   HTTP %{http_code}\n" --max-time 15 https://yourdomain.kz/
    curl -sk -o /dev/null -w "/api/health HTTP %{http_code}\n" --max-time 15 https://yourdomain.kz/api/health
```

## Особенности и подводные камни

### Plesk Node.js: рестарт через `tmp/restart.txt`

Если у тебя Plesk запускает Next.js через nodejs.app (`Restart App` button), после FTP-загрузки **обязательно** дёрнуть рестарт:

```yaml
- name: Trigger Plesk restart
  run: |
    python3 -c "
    import ftplib, os
    ftp = ftplib.FTP(os.environ['FTP_HOST'])
    ftp.login(os.environ['FTP_USER'], os.environ['FTP_PASS'])
    ftp.cwd(os.environ['REMOTE_ROOT'] + '/tmp')
    from io import BytesIO
    ftp.storbinary('STOR restart.txt', BytesIO(b''))
    "
```

Альтернатива — Plesk REST API (`/api/v2/cli/site/call`), но требует привилегий.

### Что НЕ грузить

- `.next/cache/` — server-cache, регенерируется при первом запросе.
- `.next/dev/` — артефакты dev-режима.
- `.next/trace/` — server-trace, дебаг-only.
- `.next/diagnostics/` — Sentry/диагностика.
- `.next/standalone/` — копия node_modules, не нужна на Plesk (там свой `npm install`).
- `node_modules/` — Plesk сам установит из `package.json` через UI.

### Concurrency

В workflow стоит:

```yaml
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false
```

Это **не отменяет** текущий деплой — следующий ждёт. Если отменять (cancel-in-progress: true) — рискуешь поломать FTP-сессию посреди upload'а.

### Когда FTP отказывается

Если ProFTPD начинает банить (timeouts, 421 errors, или внезапно медленно) — обычно после большого количества STOR без задержки. Решения:
1. Между STOR — `time.sleep(0.05)` (50ms).
2. Reconnect каждые 200-300 файлов.
3. Связаться с хостером — попросить увеличить лимит `MaxClientsPerHost`.

## Альтернативы (когда отказываемся от Plesk FTP)

1. **GHCR + Watchtower** (см. [`deploy-ghcr-watchtower.md`](deploy-ghcr-watchtower.md)) — если есть VPS / Docker.
2. **Vercel** — если проект полностью в App Router без фоновых джобов / cron / БД на том же сервере.
3. **Cloudflare Pages + Workers** — если статический + edge functions.
4. **`rsync` через SSH** — если хостер даёт SSH-доступ (некоторые Hoster.kz тарифы дают). Быстрее FTP.

## Проверка работы

После пуша в `main`:

1. GitHub Actions → workflow `Deploy to hoster.kz` зелёный
2. Smoke-check показывает `HTTP 200`
3. Открыть сайт в инкогнито → ассеты обновлены (новые хеши `_next/static/...`)
4. Проверить SSR-страницы — что данные свежие (если есть кеш-revalidate)

Если упало — лог в GH Actions покажет на каком файле / коде ошибки. Чаще всего:
- `530 Login incorrect` → неверный `FTP_USER`/`FTP_PASS`
- `550 Permission denied` → пользователю не дан write на `REMOTE_ROOT`
- `421 Service not available` → ProFTPD ban, ждать 30 минут
- `ECONNRESET` → слишком быстрый STOR, добавить sleep
