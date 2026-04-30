# Playbook: изоляция портов на multi-tenant VPS

**Цель:** на одном VPS живёт 5+ Next.js проектов и столько же Postgres'ов, никто не наступает на чужой порт, конфиги/домены/credentials не мешаются. Описать как соседи, не как смешанная конфигурация.

**Источник:** memory `feedback_project_isolation` + реальное состояние сервера m34959203 (Hoster.kz).

## Принцип

> Проекты на сервере — соседи, но независимы.

Каждый проект имеет:
- **Свою папку** в `/home/ubuntu/<project-name>/`
- **Свой контейнер БД** через `docker-compose.yml` с уникальным портом
- **Свой `next start` процесс** на уникальном порту приложения
- **Свой домен / поддомен** (через Cloudflare Tunnel или Plesk)
- **Свой `.env.local`** с credentials (никогда не делиться)

## Карта портов

### Postgres (5440-5449)

| Проект | Порт | Container name |
|---|---|---|
| smart-kids-library | 5440 | `smart-kids-library-db-1` |
| smart-library-cbs | 5441 | `smart-library-cbs-postgres-1` |
| til-kural | 5442 | `til-kural-db-1` |
| dvorets-gornyakov | 5443 | `dvorets-gornyakov-postgres-1` |
| technokod | 5444 | `technokod-db` |
| (резерв) | 5445-5449 | для следующих проектов |

### Next.js apps (3010-3019)

| Проект | Порт | Standalone-mode |
|---|---|---|
| (sky kids?) | 3010 | да |
| ? | 3012 | да |
| dvorets-gornyakov | 3013 | да |
| ? | 3014 | да |
| til-kural | 3015 / 3016 | да (3016 fallback) |
| ? | 3018 | да |

### Backend / API services (3090-3099)

| Сервис | Порт |
|---|---|
| ? | 3091 |
| ? | 3092 |
| ? | 3093 |

### Other

| Сервис | Порт |
|---|---|
| Watchtower / Ollama? | 11434 |
| FastAPI (admission-bot? mailcatcher?) | 1025 |
| RAG-server / LLM bridge | 8200 / 8443 / 9000 |
| SSH | 22 |
| Tailscale | 100.x.y.z (private mesh) |

## Правила

### 1. При создании нового проекта

1. **Резервируй порты** — выбрать следующий свободный из 304x (app) и 544x (db) диапазона. Записать в `dev-base/playbooks/server-port-isolation.md` (этот файл).
2. **Создать `docker-compose.yml`** с явным mapping `<host_port>:5432`:
   ```yaml
   services:
     db:
       image: postgres:16-alpine
       container_name: <project>-db-1
       ports:
         - "5445:5432"
       environment:
         POSTGRES_USER: <project>user
         POSTGRES_PASSWORD: <generated>
         POSTGRES_DB: <project>
   ```
3. **`.env.local`** — `DATABASE_URL=postgresql://<user>:<pwd>@localhost:5445/<project>`.
4. **`next.config.ts`** — никаких hard-coded URL, всё через env.
5. **deploy-local.sh** — установить дефолтный PORT под свой проект.

### 2. Что НЕ делать

- ❌ Не использовать дефолтный 5432 для БД — конфликт с system-postgres если установлен.
- ❌ Не использовать `network_mode: host` в docker-compose — каждый контейнер должен быть в своей default network.
- ❌ Не шарить `.env` между проектами — даже если ключ Gemini тот же, копия в каждом `.env.local` отдельно. Иначе при ротации одного — забудешь другой.
- ❌ Не подсовывать в production `DATABASE_URL` другого проекта по ошибке (бывает при копи-пасте конфигов).

### 3. Cross-project communication

Если нужно межпроектное общение (например, `claude-bridge` дёргает `technokod`):
- Через **публичный API** (HTTPS + аутентификация по токену), не через прямой доступ к БД.
- Token хранить в `.env.local` потребителя, **не** в `.env.local` поставщика.
- Логировать cross-project calls с `service=<consumer>` для дебага.

## Проверка

```bash
# Какие docker-контейнеры живут
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}'

# Какие порты слушают
ss -ltnp | grep -E ":3[0-9]{3}|:54[0-9]{2}"

# Чей next-server где
for pid in $(pgrep -f "next-server"); do
  echo "pid=$pid cwd=$(readlink /proc/$pid/cwd 2>/dev/null) port=$(cat /proc/$pid/environ 2>/dev/null | tr '\0' '\n' | grep PORT | head -1)"
done
```

## Tailscale / Cloudflare Tunnel mapping

Поскольку VPS-публичные порты обычно закрыты, доступ через:

- **Cloudflare Tunnel** (`cloudflared`) — `<project>.trycloudflare.com` или собственный домен через named tunnel.
- **Tailscale** — `100.x.y.z:<port>` для команды (не публично).
- **Plesk** — для shared-hosting проектов (vestnik-frontend), Plesk сам мапит.

В каждом проекте `next.config.ts` должен включать:

```ts
allowedDevOrigins: ["*.trycloudflare.com", "*.your-tailnet.ts.net"],
```

(Memory `feedback_nextjs_dev_trycloudflare` — иначе клиент не гидрируется.)

## Migration: что если проекты пересеклись

Если новый проект случайно занял порт старого:
1. Останови новый.
2. Не убивай старый — просто измени порт в новом docker-compose.
3. `docker compose down && docker compose up -d` для нового.
4. Обнови этот файл с новой картой.

## Связанные

- [`playbooks/nextjs-standalone-deploy-local.md`](nextjs-standalone-deploy-local.md) — `deploy-local.sh` принимает PORT параметр.
- Memory `feedback_project_isolation` — общий принцип.
