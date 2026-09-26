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
 * The toll-free number alerts are sent from — NULL while we do not have one.
 *
 * History, so nobody re-publishes a dead number: +1 888 373 9004 was bought
 * Jul 30 2026, its toll-free verification was REJECTED Jul 31 (code 30510,
 * "Opt-In Example Must Be Complete, Branded, and Legible" — the submission
 * gave a URL where carriers want a legible screenshot of the actual consent
 * box), and the number was gone from the account by Sep 26 (the trial lapsed
 * after the rejection). /sms printed it on a public page the whole time.
 *
 * When a new number is bought: set both constants AND `TWILIO_FROM` in the
 * hosting env to the same number — a mismatch is Twilio error 21606 — and
 * give it a voice greeting before it goes anywhere a robocaller will find
 * it, because inbound toll-free minutes are billed to us.
 */
export const BRAND_SMS_NUMBER: string | null = null
export const BRAND_SMS_NUMBER_DISPLAY: string | null = null
