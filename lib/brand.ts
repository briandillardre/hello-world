/**
 * Brand identity — THE single source of truth for the product name + domain.
 *
 * Referenced everywhere instead of hardcoding the name, so a rebrand (a live
 * question while trademark clearance is pending) is a config change plus a
 * logo swap — not a hunt through 40 files. Overridable via env for staging a
 * rename on a preview deployment before flipping production.
 *
 * Still intentionally hardcoded elsewhere: the logo image assets
 * (public/brand/*), manifest.json, and DB seed copy — swap those in the same
 * commit that changes these constants. `grep -ri hammertrack` finds the rest.
 */
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'HammerTrack'
// The domain we actually OWN. hammertrack.ai is still unbought (see the
// business plan) — defaulting to it silently pointed every public contact
// address at a domain with no mailbox, so "email sales@…" bounced (Jul 30).
// Flip this the day the .ai is purchased; the env var overrides for staging.
export const BRAND_DOMAIN = process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? 'hammertrackai.com'
export const BRAND_URL = `https://${BRAND_DOMAIN}`
export const BRAND_EMAIL_HELLO = `hello@${BRAND_DOMAIN}`
export const BRAND_EMAIL_SALES = `sales@${BRAND_DOMAIN}`
export const BRAND_EMAIL_SUPPORT = `support@${BRAND_DOMAIN}`
