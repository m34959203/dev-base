# Playbook: локальный standalone-deploy для Next.js

**Кейс:** на VPS живёт несколько Next.js-проектов (на разных портах), каждый собирается локально и запускается через `next start`/`node server.js` под `nohup`. Без Docker, без CI/CD — просто скрипт.

**Источник:** til-kural `scripts/deploy-local.sh` (production на сервере m34959203).

## Зачем

Реальная проблема: `output: 'standalone'` в `next.config.ts` создаёт `.next/standalone/` с минимальным runtime, **но не копирует** `public/` и `.next/static/` — без них сайт отдаёт 404 на ассеты.

Решение: `ln -sfn` симлинк после каждой сборки. Если делать `cp -r` — на больших проектах долго и в `.next/static/` хеши меняются.

Ещё одна засада: Turbopack может создать `.next/standalone/public/` как **директорию** (если кладёт туда fonts из `/public/fonts/*`). Тогда `ln -sfn /full/path public` создаст симлинк **внутри** этой директории — кривая вложенность. Скрипт это ловит и удаляет директорию перед созданием симлинка.

## Файл

[`templates/scripts/deploy-local.sh`](../templates/scripts/deploy-local.sh) — bash-скрипт.

## Что делает

```
1. npm run build
2. Удаляет .next/standalone/public если он директория (Turbopack-fix)
3. ln -sfn $ROOT/public  $ROOT/.next/standalone/public
   ln -sfn $ROOT/.next/static  $ROOT/.next/standalone/.next/static
4. fuser $PORT/tcp → kill старого процесса
5. Source .env.local
6. nohup node .next/standalone/server.js > /tmp/<app>-<port>.log 2>&1 &
7. sleep 3, проверка fuser, tail логов
```

## Установка

```bash
mkdir -p scripts
cp <dev-base>/templates/scripts/deploy-local.sh scripts/
chmod +x scripts/deploy-local.sh
```

В `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  output: 'standalone',
  // ...
};
```

## Использование

```bash
# Дефолтный порт 3015
bash scripts/deploy-local.sh

# Кастомный порт
PORT=3016 bash scripts/deploy-local.sh

# Tail логов
tail -f /tmp/$(basename $PWD)-3016.log
```

## Связка с port-isolation

Если на сервере живут несколько проектов (project_isolation memory):

| Проект | Порт |
|---|---|
| `smart-kids-library` | 3010 |
| `smart-library-cbs` | 3011 (и postgres :5441) |
| `dvorets-gornyakov` | 3013 (postgres :5443) |
| `technokod` | 3014 (postgres :5444) |
| `til-kural` | 3015 или 3016 (postgres :5442) |

Каждый проект запускается своим `deploy-local.sh` со своим `PORT=`. Для systemd-units / pm2 — отдельная история, но скрипт остаётся как «руками после изменений».

## Подводные камни

- **`output: 'standalone'`** обязателен в `next.config.ts`. Без него `.next/standalone/` не создаётся.
- **`fuser` отсутствует на macOS**. Замените на `lsof -ti:$PORT | xargs kill`.
- **`unref()` для Turbopack** — если запускаешь `next dev` (а не build → start), скрипт не подходит. Это для prod-mode.
- **`.env.local` загружается через `set -a; source .env.local; set +a`** — все переменные становятся exported. Если в файле есть `multiline values` со специальными символами — пере-quotes требуются.
- **logs ротация** — скрипт не делает ротацию `/tmp/*.log`. На активных проектах файл растёт. Добавьте `logrotate`-конфиг или периодически чистите.

## Альтернативы

| Подход | Когда |
|---|---|
| `deploy-local.sh` (этот) | VPS + несколько проектов, нет Docker, нет CI |
| Docker compose | Хочешь изоляцию, готов к overhead |
| pm2 | Хочешь авто-restart при креше + log management |
| systemd unit | Хочешь boot-старт + cgroups + journald |
| GHCR + Watchtower | Полностью автоматизированный CI/CD |
