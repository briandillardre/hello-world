/**
 * Brand identity — the single source of truth for the app's name + domain.
 * Set these per app (env overrides let a preview deployment try a rename).
 */
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'My App'
export const BRAND_DOMAIN = process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? 'example.com'
export const BRAND_URL = `https://${BRAND_DOMAIN}`
export const BRAND_EMAIL_HELLO = `hello@${BRAND_DOMAIN}`
