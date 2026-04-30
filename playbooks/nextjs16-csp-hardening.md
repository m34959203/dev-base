# Playbook: Next.js 16 production hardening (CSP + HSTS + headers)

**Цель:** боевой `next.config.ts` с CSP, HSTS, COOP, Permissions-Policy, standalone-output, безопасным image whitelist. Готов выдержать audit от security-сканера.

**Источник:** technokod `next.config.ts` (production-tested).

## Когда применять

- Любой production Next.js → CSP/HSTS обязательны для оценки A+ на securityheaders.com и Mozilla Observatory.
- Перед сабмитом в Colosseum / любой хакатон-платформу с auto-аудитом.
- Если сайт принимает оплаты или собирает PII — без CSP отчёт по GDPR/152-ФЗ слабее.

## Файл

[`templates/next.config.production.ts`](../templates/next.config.production.ts) — 133 строки, drop-in замена для `next.config.ts`.

## Что включено

### 1. Content Security Policy (CSP)

Полный набор директив с whitelisting для типичного AI-стека:

- `script-src` — Spline (WebGL/WASM), Cloudflare Insights, jsdelivr/unpkg для виджетов.
- `connect-src` — `generativelanguage.googleapis.com` + `wss:` для Gemini Live, Telegram Bot API, Sentry, Cloudflare beacon.
- `img-src` — `data:` для inline base64 (TipTap, иконки), `blob:` для File API previews, GitHub avatars, Unsplash.
- `frame-src` — YouTube, Vimeo, Telegram embeds.
- `style-src` — Google Fonts; `'unsafe-inline'` оставлен для Tailwind v4 critical CSS.
- `frame-ancestors: 'none'` + `X-Frame-Options: DENY` — защита от clickjacking.

### 2. HSTS

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

`max-age=2 года`. Перед раскаткой убедись, что все subdomain'ы тоже на HTTPS.

### 3. Cross-Origin Policies

- `Cross-Origin-Opener-Policy: same-origin` — изоляция BroadcastChannel/SharedWorker.
- `Cross-Origin-Resource-Policy: same-origin` — защита от Spectre.

### 4. Permissions-Policy

Запрет camera/microphone/geolocation **по умолчанию**. Если нужны для Voice AI — ослабить точечно:

```ts
"Permissions-Policy": "camera=(), microphone=(self), geolocation=()"
```

### 5. `output: 'standalone'`

Минимизирует Docker image (~200MB вместо 1GB). Требуется для GHCR + Watchtower deploy.

### 6. `images.remotePatterns`

Whitelisting для `next/image`. Без него внешние URL падают. Добавлено: Unsplash, GitHub avatars (`avatars.githubusercontent.com`), Telegram CDN (`cdn4.telesco.pe`).

### 7. Cache rules

```
/_next/static/*       → public, max-age=31536000, immutable
/_next/image/*        → public, max-age=86400, stale-while-revalidate=604800
/api/*                → no-cache, no-store, must-revalidate
```

## Установка

```bash
cp <dev-base>/templates/next.config.production.ts next.config.ts
```

Адаптировать:

1. `SITE_URL` fallback → твой домен.
2. В `CSP_DIRECTIVES.script-src/connect-src` добавить/убрать сервисы под свой стек.
3. Если **не** используешь Spline / Telegram embed / Cloudflare Insights — убрать соответствующие записи.
4. Если используешь **Sentry** — раскомментировать `report-uri` директиву.
5. Если используешь **Yandex Metrika** — добавить в `script-src`:
   ```
   "https://mc.yandex.ru",
   "https://mc.yandex.com",
   ```
   и в `connect-src`: `"https://mc.yandex.ru"`.

## Проверка

```bash
# Локально
curl -I https://localhost:3000 | grep -iE 'content-security|strict-transport|x-frame'

# После деплоя
curl -I https://yourdomain.com | grep -iE 'content-security|strict-transport|x-frame'
```

Онлайн-аудит:
- https://securityheaders.com/?q=yourdomain.com — должен быть **A+**
- https://observatory.mozilla.org/?q=yourdomain.com — должен быть **A+** или **A**

Если **B/C** — смотри какие headers пропущены, добавляй.

## Подводные камни

- **`'unsafe-inline'` в `style-src`** — Tailwind v4 без него ломается. Это compromise; альтернатива — nonce-based CSP, но требует CSR-инжект → конфликт со static optimization.
- **`'unsafe-eval'` в `script-src`** — нужен для Next 16 dev runtime; в prod build можно убрать, но тогда сломаются некоторые webpack chunks. Оставлено по умолчанию.
- **Spline / 3D-эмбеды** — требуют `'wasm-unsafe-eval'`. Без него белый экран в hero-секции.
- **TipTap RichEditor** требует `'unsafe-inline'` стилей и `data:` images. Учтено.
- **Web Push (VAPID)** не требует CSP-послаблений — работает через service worker.
- **Cloudflare Insights** инжектится автоматически при включении в дашборде CF — без whitelist получишь CSP-violation в консоли.

## Альтернативный (упрощённый) dev-config

Для `til-kural`-стиля dev-проектов — минимальный config с `allowedDevOrigins: ["*.trycloudflare.com"]` для tunneling:

```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.unsplash.com" },
    ],
  },
};
export default nextConfig;
```

Это для разработки через cloudflared tunnel. Production-config из `templates/` — для боевого деплоя.
