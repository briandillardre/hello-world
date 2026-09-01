import type { MetadataRoute } from 'next'
import { BRAND_URL } from '@/lib/brand'

/**
 * Crawl rules. The marketing pages are the product's front door; everything
 * behind the auth gate is noise to a crawler (and a login redirect anyway), so
 * it is disallowed to keep crawl budget on the pages that convert. Until
 * Sep 1 2026 this file did not exist — /robots.txt was a 404.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          // dashboard (auth-gated)
          '/accounting', '/activity', '/alerts', '/assets', '/board', '/clock', '/diag',
          '/finance', '/help/', '/logs', '/maintenance', '/map', '/measurements', '/model',
          '/qr', '/receipts', '/reports', '/settings', '/tags', '/team', '/welcome', '/zones',
          // token / magic-link surfaces
          '/r/', '/share/', '/s/', '/t/', '/join', '/track',
          '/login', '/register', '/forgot', '/reset',
        ],
      },
    ],
    sitemap: `${BRAND_URL}/sitemap.xml`,
  }
}
