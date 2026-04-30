// next.config.production.ts — production-grade hardening для Next.js 16.
// Источник: technokod (production). Включает: CSP/HSTS/COOP/Permissions-Policy,
// standalone output, image remotePatterns, cache rules.
//
// Адаптация при копировании:
//   1. Заменить SITE_URL fallback на свой домен.
//   2. В CSP-блоках script-src/connect-src/img-src/frame-src добавить/удалить
//      внешние сервисы под свой стек: AI (generativelanguage.googleapis.com,
//      api.openai.com), embed (Spline, YouTube), analytics (Cloudflare, Yandex).
//   3. Если используете Sentry — раскомментировать sentry.report-uri.
//   4. Если не используете Telegram embed/виджеты — удалить t.me и api.telegram.org.

import type { NextConfig } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";

// ─── Content Security Policy ───────────────────────────────────────────────
// Keep 'unsafe-inline' for styles (Tailwind v4 + inline critical); scripts are
// hashed/nonced by Next at build time — 'unsafe-inline' kept only for JSON-LD
// <script type="application/ld+json">, which is considered safe.
const CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'", // Next 16 dev/runtime chunks
    "'wasm-unsafe-eval'", // Spline WebGL/WASM
    "blob:", // dynamic workers
    "https://cdn.jsdelivr.net",
    "https://unpkg.com",
    "https://prod.spline.design",
    "https://*.spline.design",
    "https://static.cloudflareinsights.com", // CF auto-injected analytics beacon
  ],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https:",
  ],
  "media-src": ["'self'", "https:", "data:", "blob:"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "connect-src": [
    "'self'",
    "https://prod.spline.design",
    "https://*.spline.design",
    "https://unpkg.com", // Spline loads WASM from unpkg
    "https://cdn.jsdelivr.net",
    "https://cloudflareinsights.com",
    "https://static.cloudflareinsights.com",
    "https://generativelanguage.googleapis.com",
    "wss://generativelanguage.googleapis.com",
    "https://openrouter.ai",
    "https://*.ingest.sentry.io",
    "https://api.telegram.org",
  ],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "upgrade-insecure-requests": [],
};

function buildCsp(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k))
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: buildCsp() },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(self), geolocation=(), interest-cohort=(), payment=(), usb=(), autoplay=(self)",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,

  serverExternalPackages: ["argon2", "@prisma/client", "@sentry/nextjs"],

  experimental: {
    ppr: false,
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "prod.spline.design" },
      { protocol: "https", hostname: "*.spline.design" },
      { protocol: "https", hostname: "uploads.technokod.kz" },
      { protocol: "https", hostname: new URL(SITE_URL).hostname },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800, immutable" }],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      { source: "/home", destination: "/", permanent: true },
    ];
  },
};

export default nextConfig;
