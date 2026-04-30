# modules/seo/

Полный SEO-стэк для Next.js 16 App Router. Два варианта: business-сайт (technokod) и bilingual-портал (til-kural).

## Файлы

### Builders & helpers

- [`seo-builders.ts`](seo-builders.ts) — technokod вариант: `buildMetadata()`, `absoluteUrl()`, builders для Article/Organization/WebSite/Breadcrumbs/FAQ/Review JSON-LD. **Best for:** business/marketing-сайты с одной локалью + богатые JSON-LD.
- [`seo-bilingual.ts`](seo-bilingual.ts) — til-kural вариант: `getBaseUrl()` env-resolver, `SITE.org` со всеми реквизитами учреждения (BIN, legalName, addr_kk/_ru, director), `organizationJsonLd(locale, settings)` с DB-overlay из `site_settings` таблицы. **Best for:** kk/ru bilingual + legal-entity organization.
- [`JsonLd.tsx`](JsonLd.tsx) — компоненты-инжекторы: `OrganizationSchema`, `WebSiteSchema`, `BreadcrumbsSchema`, `ArticleSchema`. Делают `<` → `&lt;` sanitization.

### Dynamic routes

- [`sitemap-dynamic.ts`](sitemap-dynamic.ts) — technokod вариант: `force-dynamic` + DB-articles + DB-pages + service-clusters + hreflang `withAlt()`.
- [`sitemap-bilingual.ts`](sitemap-bilingual.ts) — til-kural вариант: `STATIC_PATHS × [kk,ru]` + DB news + alternates languages.
- [`robots.ts`](robots.ts) — простой robots с sitemap pointer и noindex для `/admin/*` + `/api/*`.
- [`manifest.ts`](manifest.ts) — PWA manifest с brand-colors, theme-color, icons.

### Service-clusters (SEO-генератор страниц)

- [`service-clusters.example.ts`](service-clusters.example.ts) — пример массива из ~10 кластеров услуг (h1/metaTitle/metaDescription/faq/keywords/relatedSlugs). Каждый рендерится как `/services/[slug]` страница → +N landing'ов с уникальными мета-данными.

## Использование

### `buildMetadata()` для каждой страницы

```ts
// app/(site)/blog/[slug]/page.tsx
import { buildMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const article = await prisma.article.findUnique({ where: { slug }});
  if (!article) return {};

  return buildMetadata({
    title: article.title,
    description: article.excerpt,
    path: `/blog/${slug}`,
    ogImage: `/api/og?slug=${slug}`,
    type: 'article',
    publishedAt: article.publishedAt,
    modifiedAt: article.updatedAt,
  });
}
```

### Inject JSON-LD на странице

```tsx
import { ArticleSchema, BreadcrumbsSchema } from '@/components/JsonLd';

export default async function BlogPost({ params }: ...) {
  const article = await getArticle(slug);
  return (
    <>
      <ArticleSchema article={article} />
      <BreadcrumbsSchema items={[{name: 'Главная', url: '/'}, {name: 'Блог', url: '/blog'}, {name: article.title, url: `/blog/${slug}`}]} />
      <article>...</article>
    </>
  );
}
```

### Root layout — Organization + WebSite + Nav

```tsx
// app/layout.tsx
import { OrganizationSchema, WebSiteSchema } from '@/components/JsonLd';

export default function RootLayout({ children }: ...) {
  return (
    <html lang="ru">
      <head>
        <OrganizationSchema />
        <WebSiteSchema />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

## Адаптация при копировании

1. `SITE_URL` / `getBaseUrl()` — заменить fallback на свой домен.
2. `SITE.org` (для bilingual) — наполнить реквизитами своей организации (legalName / BIN или INN / адрес / директор).
3. `keywords` массив в `seo-builders.ts` — заменить на свои.
4. `service-clusters.example.ts` — наполнить под свои услуги или удалить если не нужны.
5. `images.remotePatterns` в next.config — добавить домены, на которые ссылается OG-image / sitemap.
6. **hreflang**: для bilingual обязательно `kk`, `ru`, `x-default`.

## Чек-лист релиза

См. [`playbooks/seo-checklist.md`](../../playbooks/seo-checklist.md).

## Связанные

- [`prompts/seo-meta-from-content.md`](../../prompts/seo-meta-from-content.md) — AI-генерация meta из тела статьи (TBD).
- [`templates/og-image-route.tsx`](../../templates/og-image-route.tsx) — generic OG-image route (TBD).
