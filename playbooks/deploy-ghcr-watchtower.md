# Playbook: Deploy через GHCR + Watchtower (без SSH-секретов в CI)

**Кейс:** VPS с Docker, доступ по SSH у тебя есть, но **CI не должен** содержать SSH-ключ к проду. Решение: GitHub Actions пушит образ в `ghcr.io`, Watchtower на сервере его ловит и пересоздаёт контейнер.

**Источник:** technokod (technokod.kz), production через Cloudflare Tunnel.

## Зачем

Альтернатива «SSH из CI». Преимущества:
- **Нет приватных ключей** в репо или GitHub Secrets — `GITHUB_TOKEN` достаточен для GHCR push.
- **Откат** через `docker run :sha-abc1234` без новой сборки.
- **Watchtower** auto-discovery: достаточно поднять рядом с целевым контейнером.
- **Мульти-инстансы** на разных серверах слушают один тег — pull в момент готовности.

Минусы:
- ~5–8 минут лаг между push в `main` и live (Watchtower polling-интервал).
- Образ в GHCR публичен по умолчанию для public-репо; для private-репо нужен `docker login` на сервере.

## Файлы

- [`modules/ci/deploy-ghcr-watchtower.yml`](../modules/ci/deploy-ghcr-watchtower.yml) — GitHub Actions workflow

## Установка

### 1. Dockerfile.prod в проекте

Multi-stage Next.js standalone:

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
```

### 2. Workflow в `.github/workflows/deploy.yml`

Скопировать `deploy-ghcr-watchtower.yml`, адаптировать:
- `IMAGE_NAME` уже ставится из `${{ github.repository }}` — не трогать.
- В repo Variables (`Settings → Variables → Actions`): `HEALTH_URL = https://yourdomain/api/health`.

### 3. На сервере — Watchtower

`docker-compose.yml` рядом с боевым контейнером:

```yaml
services:
  app:
    image: ghcr.io/m34959203/yourrepo:latest
    container_name: yourapp
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    environment:
      - DATABASE_URL=...
      - AUTH_SECRET=...
    networks:
      - default

  watchtower:
    image: containrrr/watchtower:latest
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /home/ubuntu/.docker/config.json:/config.json:ro  # для private-репо
    command:
      - --label-enable
      - --interval=300        # 5 минут polling
      - --cleanup
      - --rolling-restart
```

Запуск:
```bash
docker compose up -d
```

### 4. Для private-репо — docker login на сервере

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin
```
(`GHCR_PAT` — Personal Access Token со scope `read:packages`)

`config.json` ляжет в `~/.docker/` и Watchtower его прочтёт.

## Алгоритм работы

```
git push origin main
  ↓
GitHub Actions: build & push to ghcr.io
  ├─ ghcr.io/<repo>:latest          ← Watchtower на сервере следит за этим тегом
  └─ ghcr.io/<repo>:sha-abc1234     ← постоянный тег для отката
  ↓ (ждём до 5 мин)
Watchtower polling → pulls new digest → recreates container
  ↓
HEALTHCHECK проходит, Cloudflare/proxy подхватывает
  ↓
GitHub Actions smoke-test: curl HEALTH_URL до HTTP 200 (до 8 мин)
```

## Откат на предыдущую версию

```bash
docker pull ghcr.io/<repo>:sha-abc1234
docker compose up -d --force-recreate app
```

Watchtower не сорвёт откат, если поставить тег явно (не `:latest`).

## Smoke-test в CI

Workflow ждёт до **8 минут** (48 итераций × 10 сек) после build, проверяет `HEALTH_URL`. Если за 8 минут health не зелёный — fail. Это и cron-ranged sanity-check Watchtower'а.

## Подводные камни

- **`GITHUB_TOKEN` для GHCR push** требует `permissions: { contents: read, packages: write }` в job — это уже прописано в workflow.
- **Watchtower polling interval** — по умолчанию 1 час, в примере выше выставлен 5 мин (`--interval=300`).
- **`--rolling-restart`** актуален для multi-replica (если у тебя 2+ инстанса этого сервиса). Для соло-контейнера можно убрать.
- **`--cleanup`** удаляет старый образ после успешного pull. Без него ghcr-образы накапливаются (`docker images` распухает).
- **HEALTHCHECK в Dockerfile** обязателен — Watchtower и Docker compose от него зависят при `--rolling-restart`.

## Альтернативы

| Подход | Когда использовать |
|---|---|
| **GHCR + Watchtower** (этот) | VPS + Docker, нет SSH из CI, лаг 5 мин ок |
| **Plesk FTP** ([deploy-nextjs-plesk-ftp.md](deploy-nextjs-plesk-ftp.md)) | Shared-хостинг без Docker (Hoster.kz и т.п.) |
| **SSH deploy from CI** | Нужен мгновенный rollout; принимаем риск с ключом в Secrets |
| **Vercel / Cloudflare Pages** | Чистый Next.js без бэкграунд-джобов, БД на стороне |
| **Argo CD / Flux** | Кубернетес, нужен GitOps вместо polling |
