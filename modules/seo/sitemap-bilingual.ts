import type { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/seo';
import { db } from '@/lib/db';
import { CULTURE_SLUGS } from '@/data/culture-topics';

const STATIC_PATHS = [
  '',
  '/about',
  '/news',
  '/events',
  '/rules',
  '/resources',
  '/contacts',
  '/learn',
  '/learn/dialog',
  '/learn/writing',
  '/learn/pronunciation',
  '/learn/lessons',
  '/learn/basics',
  '/test',
  '/test/level',
  '/test/kaztest',
  '/test/topics',
  '/kaztest-info',
  '/photo-check',
  '/game',
  '/game/quests',
  '/game/leaderboard',
  '/game/achievements',
  '/culture',
  ...CULTURE_SLUGS.map((s) => `/culture/${s}`),
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();
  const entries: MetadataRoute.Sitemap = [];
  const now = new Date();

  for (const path of STATIC_PATHS) {
    for (const locale of ['kk', 'ru'] as const) {
      entries.push({
        url: `${base}/${locale}${path}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: path === '' ? 1 : 0.7,
        alternates: {
          languages: {
            kk: `${base}/kk${path}`,
            ru: `${base}/ru${path}`,
          },
        },
      });
    }
  }

  try {
    const news = await db.query('news', { status: 'published' });
    for (const item of news) {
      for (const locale of ['kk', 'ru'] as const) {
        entries.push({
          url: `${base}/${locale}/news/${item.slug}`,
          lastModified: item.updated_at || item.published_at || now,
          changeFrequency: 'monthly',
          priority: 0.6,
        });
      }
    }
  } catch {
    /* noop — DB may be empty */
  }

  return entries;
}
