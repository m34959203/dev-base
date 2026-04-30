import type { MetadataRoute } from 'next';
import { getBaseUrl, SITE } from '@/lib/seo';

export default function manifest(): MetadataRoute.Manifest {
  const base = getBaseUrl();
  return {
    id: `${base}/kk`,
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.tagline_kk,
    start_url: '/kk',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f766e',
    lang: 'kk',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
