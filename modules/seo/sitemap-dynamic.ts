import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { prisma } from "@/lib/db";
import { SERVICE_CLUSTERS } from "@/lib/service-clusters";

// Генерируем sitemap на каждый запрос — статьи и страницы появляются без ребилда
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Loose = { slug: string; updatedAt?: Date; publishedAt?: Date | null };

async function fetchArticles(): Promise<Loose[]> {
  const model = prisma.article;
  if (!model) return [];
  try {
    const rows = await model.findMany({
      where: { publishedAt: { not: null }, status: "published" },
      select: { slug: true, updatedAt: true, publishedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 5000,
    });
    return rows;
  } catch (err) {
    console.error("sitemap.fetchArticles failed:", err);
    return [];
  }
}

async function fetchPages(): Promise<Loose[]> {
  const model = prisma.page;
  if (!model) return [];
  try {
    return await model.findMany({
      where: { publishedAt: { not: null } },
      select: { slug: true, updatedAt: true, publishedAt: true },
      take: 5000,
    });
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  // /ru — дефолтная локаль на корне, /kk/* — казахский вариант
  const withAlt = (path: string) => ({
    ru: `${SITE_URL}${path}`,
    kk: `${SITE_URL}/kk${path === "/" ? "" : path}`,
  });
  // Реально существующие страницы. /services — якорь на главной (#services), остальные — отдельные URL.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0, alternates: { languages: withAlt("/") } },
    { url: `${SITE_URL}/services`, lastModified: now, changeFrequency: "monthly", priority: 0.95, alternates: { languages: withAlt("/services") } },
    ...SERVICE_CLUSTERS.map((c) => ({
      url: `${SITE_URL}/services/${c.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.9,
      alternates: { languages: withAlt(`/services/${c.slug}`) },
    })),
    { url: `${SITE_URL}/cases`, lastModified: now, changeFrequency: "weekly", priority: 0.9, alternates: { languages: withAlt("/cases") } },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.85, alternates: { languages: withAlt("/about") } },
    { url: `${SITE_URL}/team`, lastModified: now, changeFrequency: "monthly", priority: 0.8, alternates: { languages: withAlt("/team") } },
    { url: `${SITE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.8, alternates: { languages: withAlt("/contact") } },
    { url: `${SITE_URL}/blog`, lastModified: now, changeFrequency: "daily", priority: 0.8, alternates: { languages: withAlt("/blog") } },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3, alternates: { languages: withAlt("/privacy") } },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3, alternates: { languages: withAlt("/terms") } },
  ];

  const [articles, pages] = await Promise.all([fetchArticles(), fetchPages()]);

  const articleRoutes: MetadataRoute.Sitemap = articles.map((a) => ({
    url: `${SITE_URL}/blog/${a.slug}`,
    lastModified: a.updatedAt ?? a.publishedAt ?? now,
    changeFrequency: "weekly",
    priority: 0.7,
    alternates: {
      languages: {
        ru: `${SITE_URL}/blog/${a.slug}`,
        kk: `${SITE_URL}/kk/blog/${a.slug}`,
      },
    },
  }));

  const pageRoutes: MetadataRoute.Sitemap = pages.map((p) => ({
    url: `${SITE_URL}/${p.slug}`,
    lastModified: p.updatedAt ?? p.publishedAt ?? now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...articleRoutes, ...pageRoutes];
}
