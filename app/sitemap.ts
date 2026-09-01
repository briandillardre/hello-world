import type { MetadataRoute } from 'next'
import { BRAND_URL } from '@/lib/brand'

/** The public pages worth indexing, in priority order. Auth-gated and
 *  token-addressed routes are deliberately absent (see robots.ts). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const page = (path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] = 'weekly') => ({
    url: `${BRAND_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  })
  return [
    page('/', 1.0),
    page('/demo', 0.9),
    page('/pricing', 0.9),
    page('/live', 0.7),
    page('/reserve', 0.6),
    page('/contact', 0.5, 'monthly'),
    page('/sms', 0.3, 'yearly'),
    page('/privacy', 0.3, 'yearly'),
    page('/terms', 0.3, 'yearly'),
    page('/delete-account', 0.2, 'yearly'),
  ]
}
