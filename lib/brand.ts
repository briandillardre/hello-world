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
// hammertrack.ai is OWNED and runs Google Workspace (brian@hammertrack.ai,
// confirmed Jul 30) — it's the real front door. hammertrackai.com is the
// secondary/redirect domain. Public contact addresses (sales@ / hello@ /
// support@) resolve here and must exist as Workspace aliases or groups.
export const BRAND_DOMAIN = process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? 'hammertrack.ai'
export const BRAND_URL = `https://${BRAND_DOMAIN}`
export const BRAND_EMAIL_HELLO = `hello@${BRAND_DOMAIN}`
export const BRAND_EMAIL_SALES = `sales@${BRAND_DOMAIN}`
export const BRAND_EMAIL_SUPPORT = `support@${BRAND_DOMAIN}`

/**
 * The toll-free number alerts are sent from (Twilio, bought Jul 30 2026).
 * E.164 for APIs, formatted for humans. This is also the number that must be
 * set as TWILIO_FROM in the hosting env — they are the same number, and a
 * mismatch is Twilio error 21606.
 *
 * NOT yet published on the marketing pages: inbound minutes on a toll-free
 * number are billed to us, so it needs a voice greeting before it goes
 * anywhere a robocaller will find it.
 */
export const BRAND_SMS_NUMBER = '+18883739004'
export const BRAND_SMS_NUMBER_DISPLAY = '(888) 373-9004'
