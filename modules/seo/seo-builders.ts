/**
 * seo.ts — metadata + JSON-LD helpers for Next.js 16 App Router.
 *
 * All URLs must be absolute when embedded into JSON-LD / og tags.
 * Site URL resolves from NEXT_PUBLIC_SITE_URL (falls back to https://technokod.kz).
 */
import type { Metadata } from "next";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://technokod.kz").replace(/\/$/, "");
export const SITE_NAME = "TechnoKod";
export const SITE_TAGLINE_RU = "Разработка сайтов и AI-интеграций в Казахстане";
export const SITE_TAGLINE_KK = "Қазақстандағы веб-сайт және AI интеграция студиясы";
export const DEFAULT_LOCALE: Locale = "ru";

export type Locale = "ru" | "kk" | "en";

export type BuildMetadataInput = {
  title: string;
  description: string;
  image?: string;
  path?: string;
  pathname?: string;
  type?: "website" | "article" | "profile";
  locale?: Locale;
  publishedTime?: string;
  modifiedTime?: string;
  authors?: string[];
  tags?: string[];
  noIndex?: boolean;
};

export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

const localeMap: Record<Locale, string> = {
  ru: "ru_RU",
  kk: "kk_KZ",
  en: "en_US",
};

export function buildMetadata(input: BuildMetadataInput): Metadata {
  const {
    title,
    description,
    image,
    path = "/",
    pathname,
    type = "website",
    locale = DEFAULT_LOCALE,
    publishedTime,
    modifiedTime,
    authors,
    tags,
    noIndex = false,
  } = input;

  const url = absoluteUrl(path);
  const ogImage = image ? absoluteUrl(image) : absoluteUrl("/og-default.png");
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} — ${SITE_NAME}`;

  return {
    metadataBase: new URL(SITE_URL),
    title: fullTitle,
    description,
    alternates: {
      canonical: url,
      languages: pathname
        ? {
            ru: pathname,
            kk: `/kk${pathname === "/" ? "" : pathname}`,
          }
        : {
            "ru-RU": absoluteUrl(path),
            "kk-KZ": absoluteUrl(`/kk${path === "/" ? "" : path}`),
          },
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
    openGraph: {
      type,
      url,
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      locale: localeMap[locale],
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      ...(type === "article"
        ? { publishedTime, modifiedTime, authors, tags }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
    },
    icons: {
      icon: [
        { url: "/favicon.ico" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    },
    manifest: "/site.webmanifest",
  };
}

// ─── JSON-LD builders ───────────────────────────────────────────────────────
export type ArticleForJsonLd = {
  title: string;
  description: string;
  slug: string;
  image?: string;
  authorName?: string;
  publishedAt: string | Date;
  updatedAt?: string | Date;
  tags?: string[];
};

export function buildArticleJsonLd(a: ArticleForJsonLd) {
  const url = absoluteUrl(`/blog/${a.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: a.title,
    description: a.description,
    image: a.image ? absoluteUrl(a.image) : absoluteUrl("/og-default.png"),
    author: {
      "@type": "Person",
      name: a.authorName ?? SITE_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: { "@type": "ImageObject", url: absoluteUrl("/icons/icon-512.png") },
    },
    datePublished: new Date(a.publishedAt).toISOString(),
    dateModified: new Date(a.updatedAt ?? a.publishedAt).toISOString(),
    keywords: a.tags?.join(", "),
  };
}

export function buildOrganizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: absoluteUrl("/icons/icon-512.png"),
    sameAs: [
      "https://github.com/m34959203",
    ],
    address: {
      "@type": "PostalAddress",
      addressCountry: "KZ",
      addressLocality: "Алматы",
    },
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        email: process.env.ADMIN_EMAIL ?? "info@technokod.kz",
        availableLanguage: ["ru", "kk", "en"],
      },
    ],
  };
}

export function buildWebsiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/search?q={query}`,
      "query-input": "required name=query",
    },
  };
}

export type FAQItem = { question: string; answer: string };

export function buildFAQJsonLd(items: FAQItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.question,
      acceptedAnswer: { "@type": "Answer", text: it.answer },
    })),
  };
}

export type TestimonialItem = {
  author: string;
  role?: string;
  company?: string;
  rating: number;
  body: string;
  date: string;
};

export function buildReviewsJsonLd(items: TestimonialItem[]) {
  const avg = items.length
    ? items.reduce((s, r) => s + r.rating, 0) / items.length
    : 0;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: avg.toFixed(1),
      reviewCount: items.length,
      bestRating: 5,
      worstRating: 1,
    },
    review: items.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5 },
      reviewBody: r.body,
      datePublished: r.date,
      ...(r.company ? { publisher: { "@type": "Organization", name: r.company } } : {}),
    })),
  };
}

export type Breadcrumb = { name: string; path: string };

export function buildBreadcrumbsJsonLd(items: Breadcrumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  };
}
