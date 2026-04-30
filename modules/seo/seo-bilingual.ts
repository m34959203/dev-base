import type { Metadata } from 'next';
import type { SiteSettings } from './settings';

/**
 * Возвращает канонический базовый URL сайта.
 *
 * Порядок резолва:
 *  1. `NEXT_PUBLIC_APP_URL` — ручная настройка в .env(.local) или prod-окружении
 *     (Cloudflare Tunnel, собственный домен). Слэш на конце срезается.
 *  2. `VERCEL_URL` — Vercel preview / production (без схемы, поэтому префиксуем https).
 *  3. Dev-fallback — `http://localhost:3015`.
 *
 * В SSR внутри роутов HOST-хедер здесь недоступен, поэтому метаданные всегда
 * опираются на env. В проде выставьте `NEXT_PUBLIC_APP_URL=https://til-kural.kz`.
 */
export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3015';
}

export const SITE = {
  name: 'Тіл-құрал',
  tagline_kk: 'Қазақ тілін оқыту орталығы',
  tagline_ru: 'Центр обучения казахскому языку',
  /** @deprecated Используйте `getBaseUrl()` напрямую — оставлено для обратной совместимости. */
  get url() {
    return getBaseUrl();
  },
  twitter: '@tilkural',
  // Реальные реквизиты КГУ «УМЦ Тіл-құрал» (Сатпаев, область Ұлытау).
  // Используются как fallback, если settings в БД отсутствуют.
  org: {
    legalName_kk: '«Тіл-құрал» оқу-әдістемелік орталығы — Сәтбаев қаласының мәдениет және тілдерді дамыту бөлімінің МКҚК',
    legalName_ru: 'КГУ «Учебно-методический центр «Тіл-құрал» ГУ «Отдел культуры и развития языков города Сатпаев» области Ұлытау',
    shortName: 'УМЦ «Тіл-құрал»',
    telephone: '+7 705 314 3391',
    email: 'info@til-kural.kz',
    streetAddress_kk: 'Ұлытау обл., Сәтбаев қ., Академик Қаныш Сәтбаев даңғ., 111',
    streetAddress_ru: 'Ұлытауская обл., г. Сатпаев, пр. Академика Каныша Сатпаева, 111',
    city_kk: 'Сәтбаев',
    city_ru: 'Сатпаев',
    region_kk: 'Ұлытау облысы',
    region_ru: 'Ұлытауская область',
    country: 'KZ',
    bin: '241240033540',
    director: 'Игенберлина Мадинат Балтина',
    goszakupUrl: 'https://www.goszakup.gov.kz/ru/registry/show_supplier/745311',
  },
};

interface PageMetaInput {
  locale: string;
  title: string;
  description?: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article' | 'event';
  publishedTime?: string;
  modifiedTime?: string;
}

export function buildMetadata(input: PageMetaInput): Metadata {
  const base = getBaseUrl();
  const path = input.path || '';
  const url = new URL(path, base).toString();
  const title = `${input.title} | ${SITE.name}`;
  const description = input.description || (input.locale === 'kk' ? SITE.tagline_kk : SITE.tagline_ru);
  const ogImage = input.image
    ? (input.image.startsWith('http') ? input.image : new URL(input.image, base).toString())
    : new URL('/og-default.svg', base).toString();
  const otherLocale = input.locale === 'kk' ? 'ru' : 'kk';

  return {
    title,
    description,
    metadataBase: new URL(base),
    alternates: {
      canonical: url,
      languages: {
        kk: new URL(path.replace(/^\/ru/, '/kk') || '/kk', base).toString(),
        ru: new URL(path.replace(/^\/kk/, '/ru') || '/ru', base).toString(),
        'x-default': new URL('/kk', base).toString(),
      },
    },
    openGraph: {
      type: input.type === 'article' ? 'article' : 'website',
      locale: input.locale === 'kk' ? 'kk_KZ' : 'ru_RU',
      alternateLocale: otherLocale === 'kk' ? 'kk_KZ' : 'ru_RU',
      siteName: SITE.name,
      url,
      title,
      description,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      ...(input.publishedTime && { publishedTime: input.publishedTime }),
      ...(input.modifiedTime && { modifiedTime: input.modifiedTime }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
      site: SITE.twitter,
    },
    robots: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  };
}

/**
 * Строит schema.org Organization JSON-LD.
 * Принимает опциональные `settings` из БД — если переданы, используются актуальные
 * реквизиты (имя, телефон, email, адрес, БИН, директор). Без `settings` — статический
 * fallback из SITE.org (Сатпаев, Ұлытау).
 */
export function organizationJsonLd(locale: string, settings?: SiteSettings) {
  const isKk = locale === 'kk';
  const s = settings || {};
  const base = getBaseUrl();

  const legalName =
    (isKk ? s.org_full_name_kk : s.org_full_name_ru) ||
    (isKk ? SITE.org.legalName_kk : SITE.org.legalName_ru);
  const telephone = s.contact_phone || SITE.org.telephone;
  const email = s.contact_email || SITE.org.email;
  const streetAddress =
    (isKk ? s.contact_address_kk : s.contact_address_ru) ||
    (isKk ? SITE.org.streetAddress_kk : SITE.org.streetAddress_ru);
  const bin = s.org_bin || SITE.org.bin;
  const director = s.org_director || SITE.org.director;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'EducationalOrganization',
    '@id': `${base}/#organization`,
    name: legalName,
    legalName,
    alternateName: SITE.org.shortName,
    url: base,
    logo: `${base}/icon-512.png`,
    telephone,
    email,
    address: {
      '@type': 'PostalAddress',
      streetAddress,
      addressLocality: isKk ? SITE.org.city_kk : SITE.org.city_ru,
      addressRegion: isKk ? SITE.org.region_kk : SITE.org.region_ru,
      addressCountry: SITE.org.country,
    },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        telephone,
        email,
        contactType: 'customer service',
        availableLanguage: ['kk', 'ru'],
      },
    ],
    sameAs: [SITE.org.goszakupUrl],
    identifier: {
      '@type': 'PropertyValue',
      propertyID: 'BIN',
      value: bin,
    },
  };

  if (director) {
    jsonLd.founder = { '@type': 'Person', name: director };
    jsonLd.employee = [
      { '@type': 'Person', name: director, jobTitle: isKk ? 'Директор' : 'Директор' },
    ];
  }

  return jsonLd;
}

export function newsArticleJsonLd(params: {
  locale: string;
  title: string;
  description: string;
  image?: string;
  slug: string;
  publishedAt: string;
  modifiedAt?: string;
}) {
  const base = getBaseUrl();
  const path = `/${params.locale}/news/${params.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    '@id': `${base}${path}`,
    headline: params.title,
    description: params.description,
    image: params.image ? [params.image] : [`${base}/og-default.svg`],
    datePublished: params.publishedAt,
    dateModified: params.modifiedAt || params.publishedAt,
    publisher: {
      '@type': 'EducationalOrganization',
      name: SITE.name,
      logo: { '@type': 'ImageObject', url: `${base}/icon-512.png` },
    },
    inLanguage: params.locale === 'kk' ? 'kk-KZ' : 'ru-RU',
    mainEntityOfPage: `${base}${path}`,
  };
}

export function eventJsonLd(params: {
  locale: string;
  title: string;
  description: string;
  image?: string;
  startDate: string;
  endDate?: string;
  location?: string;
  id: string;
}) {
  const base = getBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${base}/${params.locale}/events/${params.id}`,
    name: params.title,
    description: params.description,
    startDate: params.startDate,
    ...(params.endDate && { endDate: params.endDate }),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/MixedEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: params.location || SITE.org.legalName_ru,
      address: params.locale === 'kk' ? SITE.org.streetAddress_kk : SITE.org.streetAddress_ru,
    },
    image: params.image ? [params.image] : undefined,
    organizer: { '@type': 'Organization', name: SITE.name, url: base },
    inLanguage: params.locale === 'kk' ? 'kk-KZ' : 'ru-RU',
  };
}
