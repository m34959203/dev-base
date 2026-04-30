# Playbook: SEO release checklist для Next.js 16

**Цель:** до релиза публичного сайта закрыть все обязательные SEO-пункты, чтобы попасть в топ-10 Google по ключевым запросам без переделок.

**Источник:** technokod (technokod.kz, рабочий top-10 по KZ AI-агентство), til-kural (top-3 «изучение казахского» KZ).

## Чек-лист

### Метаданные

- [ ] `metadataBase` в `app/layout.tsx` указывает на абсолютный URL.
- [ ] Каждая страница использует `generateMetadata()` с `buildMetadata({...})` helper'ом.
- [ ] `title` шаблон: `'%s | Бренд'` через `metadata.title.template`.
- [ ] `description` 150–160 символов, без точки в конце, не начинается с бренда.
- [ ] `canonical` (через `alternates.canonical`) — абсолютный URL без trailing slash.
- [ ] Для bilingual — `alternates.languages: { kk: '...', ru: '...', 'x-default': '...' }`.

### Open Graph + Twitter

- [ ] `og:image` 1200×630 PNG/JPG (не SVG, не data:URI).
- [ ] OG image — динамическая через `app/api/og/route.tsx` (Next ImageResponse) для статей.
- [ ] `og:type` = `website` / `article` / `profile` соответственно.
- [ ] `twitter:card` = `summary_large_image`.
- [ ] `og:locale: ru_KZ` или `kk_KZ` (или другая ваша).

### Structured data (JSON-LD)

- [ ] **На каждой странице:** `BreadcrumbList`.
- [ ] **На главной:** `Organization` + `WebSite` + `WebSite.potentialAction` (search action).
- [ ] **Статьи блога:** `Article` со всеми полями (`headline`, `image`, `datePublished`, `dateModified`, `author`, `publisher`).
- [ ] **События:** `Event` (для til-kural-style /events).
- [ ] **FAQ-блоки:** `FAQPage`.
- [ ] **Отзывы:** `Review` или `AggregateRating`.
- [ ] **Услуги:** `Service` или `Offer`.
- [ ] Все `<` в JSON → `&lt;` sanitization (см. `JsonLd.tsx`).

### Sitemap + robots

- [ ] `app/sitemap.ts` отдаёт 200 на `https://yourdomain/sitemap.xml`.
- [ ] Sitemap содержит **все** публичные страницы + DB-articles + DB-pages.
- [ ] Для bilingual — каждая запись с `alternates.languages`.
- [ ] `app/robots.ts` указывает sitemap pointer.
- [ ] `Disallow: /admin/`, `/api/`, `/_next/` явно прописаны.
- [ ] Submit sitemap в Google Search Console и Yandex Webmaster.

### Manifest (PWA)

- [ ] `app/manifest.ts` или `public/manifest.json`.
- [ ] `name`, `short_name`, `theme_color`, `background_color`, `icons` (192/512/maskable).
- [ ] `<link rel="manifest" href="/manifest.json">` в `<head>`.

### Headers (через next.config.ts)

- [ ] `X-Robots-Tag: noindex` на `/admin/*`, `/api/*` через middleware.
- [ ] CSP не блокирует Google Analytics / Yandex Metrika (см. `nextjs16-csp-hardening.md`).
- [ ] HSTS включён (Strict-Transport-Security).

### Performance (LCP / CLS / INP)

- [ ] Все `<img>` через `next/image` с `width`/`height`.
- [ ] Hero-картинка с `priority` prop.
- [ ] Шрифты через `next/font` (без CLS на font-swap).
- [ ] Bundle budget < 300KB First Load JS (см. `modules/ci/bundle-budget.yml`).

### Содержание

- [ ] H1 уникален на каждой странице, содержит ключевое слово.
- [ ] H2/H3 структура без скачков уровня.
- [ ] Внутренние ссылки между связанными статьями (related slugs).
- [ ] alt-текст на каждой картинке (обязательно для индексации Google Images).
- [ ] Время чтения / дата публикации видимы пользователю.

### Multilingual (для bilingual проектов)

- [ ] URL-структура: `/kk/...` и `/ru/...`.
- [ ] Middleware redirect `/` → `/{default-locale}` (с 307, не 301 — иначе проблемы при смене default).
- [ ] Hreflang `x-default` указывает на основную локаль.
- [ ] Все мета теги локализуются (`title`, `description`, `og:title`, ...).
- [ ] JSON-LD `inLanguage` соответствует локали страницы.

### Webmaster инструменты

- [ ] Google Search Console: site verified (TXT-record или meta-tag).
- [ ] Sitemap submitted в GSC.
- [ ] Yandex.Webmaster: site verified.
- [ ] Sitemap submitted в Yandex.
- [ ] Bing Webmaster Tools (опционально, через GSC можно автоматом).
- [ ] **IndexNow** ping на изменения (есть в technokod `api/indexnow`).

### Аналитика

- [ ] Google Analytics 4 или Yandex Metrika подключены через `Analytics.tsx`.
- [ ] Cookie-consent banner gating до `data-cc="accepted"` (см. `modules/analytics-frontend/`).
- [ ] Goal tracking настроен: лиды, регистрации, ключевые конверсии.

## Проверка после деплоя

```bash
# Headers + meta
curl -sI https://yourdomain/ | grep -iE 'content-type|cache-control|x-robots'
curl -s https://yourdomain/ | grep -E 'meta name="description"|<title>'

# Sitemap
curl -s https://yourdomain/sitemap.xml | head -30

# JSON-LD
curl -s https://yourdomain/ | grep -A 5 'application/ld+json' | head -30
```

Онлайн-валидаторы:
- https://search.google.com/test/rich-results — проверка JSON-LD
- https://validator.schema.org/ — schema.org validation
- https://www.opengraph.xyz/?url= — OG preview
- https://hreflang.org — hreflang validation
- https://pagespeed.web.dev/ — Core Web Vitals
- https://securityheaders.com/?q= — security headers (должно быть A+)

## Подводные камни

- **`metadataBase`** обязателен. Без него `og:image` рендерится как relative и не работает в превью.
- **Trailing slash** — выбери один вариант (с или без) и редиректь второй (308). Mixed signals портят canonical.
- **Sitemap `lastmod`** — должен быть `dateModified` статьи, не `dateCreated`. Поисковики используют для re-crawl.
- **JSON-LD `<` escape** — Google Search Console показывает «invalid JSON» если `<` не заэскейплен. Использовать `JSON.stringify(...).replace(/</g, '\\u003c')`.
- **Hreflang `x-default`** — критично для не-английских сайтов. Без него Google путается, какую локаль показывать в SERP.
- **OG-image размер** — < 5MB (Facebook), > 200×200, рекомендация 1200×630. Если используешь Next ImageResponse — Twitter иногда кэширует криво, добавь `?v=2` query.
- **Service-clusters** (technokod-паттерн) — генерация дюжины landing-страниц по ключевым запросам. Сильно бустит органику, но требует уникального контента на каждой.

## Связанные

- [`modules/seo/`](../modules/seo/) — все builders + JsonLd + sitemap/robots/manifest
- [`prompts/seo-meta-from-content.md`](../prompts/seo-meta-from-content.md) — AI-генерация meta из контента (TBD)
- [`nextjs16-csp-hardening.md`](nextjs16-csp-hardening.md) — security headers
