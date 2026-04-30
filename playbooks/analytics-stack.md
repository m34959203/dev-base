# Playbook: трёхуровневая аналитика (consent → event store → dashboard)

**Цель:** GDPR/152-ФЗ-compliant tracking + custom event API + admin-дашборд с воронкой и UTM. Без зависимости от внешних сервисов как единой точки отказа.

**Источники:** til-kural (frontend GA4+YM consent-gated) + dvorets-gornyakov (backend event store с rate-limit) + technokod (admin dashboard recharts).

## Архитектура

```
1. Frontend: consent banner → Analytics.tsx (GA4 + YM, gated по data-cc="accepted")
   ↓ user принимает cookies → Script-теги активируются
   
2. Backend: POST /api/analytics/event (custom event store)
   ↓ rate-limit 20/мин/IP, session cookie, whitelist event types
   ↓ запись в analytics_events таблицу
   
3. Admin: /admin/analytics dashboard
   ↓ KPI карточки + recharts (LineChart + FunnelChart) + UTM-таблица
```

Три уровня **независимы**. Можно использовать один без другого:
- Только Frontend (GA4) — простой landing.
- Только Backend (custom events) — для приложения с server-events.
- Frontend + Backend — full stack.

## Файлы

### Frontend (consent + tracking)

- [`modules/analytics-frontend/CookieConsent.tsx`](../modules/analytics-frontend/CookieConsent.tsx) — banner UI («Принять / Отклонить»), пишет в localStorage.
- [`modules/analytics-frontend/AnalyticsConsent.tsx`](../modules/analytics-frontend/AnalyticsConsent.tsx) — слушатель событий `cookie-consent-{accepted,declined}`. Меняет `data-cc` атрибут на `<html>` элементе.
- [`modules/analytics-frontend/Analytics.tsx`](../modules/analytics-frontend/Analytics.tsx) — `<Script>` теги GA4 + Yandex Metrika с **`strategy="lazyOnload"`** + проверкой `document.documentElement.dataset.cc === 'accepted'`. ID-шники GA + YM читаются из БД-settings (`ga_id`, `ym_id`).

### Backend (custom event store)

- [`modules/analytics-backend/event-route.ts`](../modules/analytics-backend/event-route.ts) — POST `/api/analytics/event`:
  - Rate-limit 20 запросов/минуту/IP.
  - Session cookie `dg_sid` (генерируется при первом событии).
  - Whitelist event types: `pageview`, `enrollment_click`, `rent_request_submit`, ...
  - Device-detect (`mobile` / `desktop` из User-Agent).
  - Clamp lengths (path ≤500, referrer ≤500, payload ≤2000) — защита от injection.
- [`modules/analytics-backend/summary-route.ts`](../modules/analytics-backend/summary-route.ts) — GET `/api/admin/analytics/summary`: KPI rollup (sessions today/week/month, top paths, sources, recent events).

### Admin dashboard

- [`modules/analytics-dashboard/AnalyticsDashboard.tsx`](../modules/analytics-dashboard/AnalyticsDashboard.tsx) — recharts: LineChart + FunnelChart (pageViews → articleViews → ctaClicks → leads) + topPaths/topArticles + UTM table.

## Schema

```sql
CREATE TABLE analytics_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type VARCHAR(50) NOT NULL,            -- pageview | click | submit | ...
  path VARCHAR(500),
  session_key VARCHAR(50) NOT NULL,     -- из cookie dg_sid
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(100),
  utm_term VARCHAR(100),
  utm_content VARCHAR(100),
  referrer VARCHAR(500),
  device VARCHAR(20),                   -- mobile | desktop | tablet
  ua VARCHAR(500),
  payload JSONB,                        -- произвольные данные события
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_created ON analytics_events(created_at DESC);
CREATE INDEX idx_analytics_events_type_created ON analytics_events(type, created_at DESC);
CREATE INDEX idx_analytics_events_session ON analytics_events(session_key, created_at DESC);
CREATE INDEX idx_analytics_events_utm ON analytics_events(utm_source, utm_campaign) WHERE utm_source IS NOT NULL;

-- Опционально для retention — partitioning по месяцу
```

## Установка

### 1. Frontend — добавить в `app/layout.tsx`

```tsx
import { Analytics } from '@/components/layout/Analytics';
import { CookieConsent } from '@/components/layout/CookieConsent';
import { AnalyticsConsent } from '@/components/layout/AnalyticsConsent';

export default function RootLayout({ children }: ...) {
  return (
    <html lang="ru">
      <body>
        <Analytics />
        <AnalyticsConsent />
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}
```

В админке `/admin/settings` поля `ga_id` и `ym_id` — заполняются один раз. В коде через `getSettings()`.

### 2. Backend — applied миграцию + положить routes

```bash
psql $DATABASE_URL -f sql/analytics_events.sql

mkdir -p src/app/api/analytics/event src/app/api/admin/analytics/summary
cp <dev-base>/modules/analytics-backend/event-route.ts src/app/api/analytics/event/route.ts
cp <dev-base>/modules/analytics-backend/summary-route.ts src/app/api/admin/analytics/summary/route.ts
```

### 3. Trigger events со стороны клиента

```tsx
// hooks/useAnalytics.ts
export function trackEvent(type: string, payload?: Record<string, any>) {
  if (typeof window === 'undefined') return;
  if (document.documentElement.dataset.cc !== 'accepted') return;
  
  const utm = new URLSearchParams(window.location.search);
  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      path: window.location.pathname,
      utm_source: utm.get('utm_source'),
      utm_medium: utm.get('utm_medium'),
      utm_campaign: utm.get('utm_campaign'),
      referrer: document.referrer,
      payload,
    }),
    keepalive: true,
  }).catch(() => {});  // analytics никогда не ломает UX
}

// Использование:
<button onClick={() => trackEvent('cta_click', { variant: 'hero' })}>Купить</button>
```

### 4. Admin dashboard

```tsx
// app/(admin)/admin/analytics/page.tsx
import { AnalyticsDashboard } from '@/components/admin/AnalyticsDashboard';

export default async function AnalyticsAdmin() {
  const summary = await fetch('/api/admin/analytics/summary').then(r => r.json());
  return <AnalyticsDashboard summary={summary} />;
}
```

## События для отслеживания (whitelist)

Стандартный набор:
- `pageview` — авто (через router events)
- `cta_click` — клик по любому CTA-кнопку (variant в payload: 'hero' | 'pricing' | 'footer')
- `form_submit` — отправка формы (form_name в payload)
- `lead_created` — серверное событие (создание лида)
- `purchase` — покупка/конверсия
- `share` — поделиться (channel в payload: 'twitter' | 'whatsapp' | 'telegram')
- `video_play` / `video_complete` — для видео-контента
- `scroll_50` / `scroll_100` — глубина скролла (для блогов)
- `outbound_click` — клик на внешнюю ссылку (target в payload)

Внутри проекта добавляй свои: `enrollment_click` (для til-kural), `rent_request_submit` (для dvorets) и т.д.

## Адаптация при копировании

1. **Брэнд cookie name** — `dg_sid` (dvorets) → `<your_app>_sid`.
2. **GA4 / YM IDs** — храни в DB-settings (как til-kural), не в env.
3. **CSP** — добавить в `next.config.ts`:
   ```
   script-src: ...['https://www.googletagmanager.com', 'https://mc.yandex.ru'],
   connect-src: ...['https://www.google-analytics.com', 'https://mc.yandex.ru'],
   img-src: ...['https://mc.yandex.ru'],
   ```
4. **Dashboard recharts colors** — заменить под свои brand-tokens.
5. **Whitelist event types** в `event-route.ts` — наполнить под свои события.

## Подводные камни

- **`keepalive: true`** в fetch — критично для page-leave событий, иначе теряются.
- **Rate-limit 20/мин/IP** — может душить активные fingerprinting-инструменты типа Hotjar; для них — отдельный endpoint без лимита.
- **Cookie consent** — без него в EU/UK можно получить fine. Для KZ/РФ менее критично, но для ESG/инвестора — must.
- **`data-cc` attribute** ставится на `<html>`, не `<body>` — чтобы Script-теги в `<head>` могли его прочитать на mount.
- **PII в payload** — НЕ писать email/phone/имя в payload. Только хеш или session_key.
- **GDPR right-to-be-forgotten** — нужна кнопка в админке «Удалить все события session_key=X». Реализовать когда ESG-аудит постучит.

## Связанные

- [`modules/seo/manifest.ts`](../modules/seo/manifest.ts) — PWA manifest (отдельно от analytics).
- [`modules/auth/`](../modules/auth/) — rate-limit на event-route использует те же helpers.
- [`playbooks/seo-checklist.md`](seo-checklist.md) — Yandex Webmaster + GSC submit (рядом с analytics).
