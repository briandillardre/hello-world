import { createHmac, timingSafeEqual } from 'crypto'
import { BRAND_URL } from './brand'

/**
 * The "turn these off" token (Brian, Sep 11: "add a link in texts and emails
 * to clients to go straight to turn off or change notifications").
 *
 * An unsubscribe link has to work from a TEXT MESSAGE — thumb on a phone, no
 * login, possibly a crew member who has never opened the app. So the token IS
 * the grant, signed the same way share links are (lib/share-token.ts): no
 * table, no migration, nothing to look up.
 *
 * What it grants is deliberately tiny: read + write `companies.digest_prefs`
 * for ONE company, and the company's own name to show on the page. Nothing
 * else — not assets, not crew, not costs. The worst a leaked link can do is
 * turn a company's own summaries off, which is the same thing the recipient
 * of the message could already do.
 */

export interface NotifyPayload {
  /** The company whose digest_prefs this token may read and write. */
  companyId: string
  expMs: number
}

/** 180 days: a digest email sits in an inbox a long time, and a dead
 *  unsubscribe link is how you get marked as spam. */
export const NOTIFY_TOKEN_DAYS = 180

function secret(): string | null {
  if (process.env.SHARE_LINK_SECRET) return process.env.SHARE_LINK_SECRET
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  // Namespaced away from the share-link derivation so a replay token can
  // never be read as a prefs token or the other way round.
  return k ? createHmac('sha256', 'hammertrack-notify-v1').update(k).digest('hex') : null
}

function uuidToBytes(id: string): Buffer | null {
  const hex = id.replace(/-/g, '')
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/i.test(hex)) return null
  return Buffer.from(hex, 'hex')
}

const bytesToUuid = (b: Buffer): string => {
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const DAY = 86_400_000

/**
 * Compact on purpose: this link rides in a TEXT. A JSON+base64 payload made a
 * 157-character URL that ate a whole SMS segment on its own and read like
 * spam. Packed binary — 16 bytes of company id, 2 bytes of expiry day, 12
 * bytes of signature — lands the whole URL near 65 characters.
 */
export function createNotifyToken(companyId: string, days = NOTIFY_TOKEN_DAYS): string | null {
  const s = secret()
  const id = uuidToBytes(companyId)
  if (!s || !id) return null
  const head = Buffer.alloc(18)
  id.copy(head, 0)
  head.writeUInt16BE(Math.min(0xffff, Math.floor((Date.now() + days * DAY) / DAY)), 16)
  const body = head.toString('base64url')
  // 12 bytes = 96 bits. Unguessable for a link whose worst case is silencing
  // the summaries its own recipient already receives.
  const sig = createHmac('sha256', s).update(head).digest().subarray(0, 12).toString('base64url')
  return `${body}${sig}`
}

export function verifyNotifyToken(token: string): NotifyPayload | null {
  const s = secret()
  if (!s || typeof token !== 'string') return null
  // 18 bytes → 24 chars, 12 bytes → 16 chars.
  if (!/^[A-Za-z0-9_-]{40}$/.test(token)) return null
  try {
    const head = Buffer.from(token.slice(0, 24), 'base64url')
    if (head.length !== 18) return null
    const sig = Buffer.from(token.slice(24), 'base64url')
    const want = createHmac('sha256', s).update(head).digest().subarray(0, 12)
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null
    const expMs = head.readUInt16BE(16) * DAY
    if (expMs < Date.now()) return null
    return { companyId: bytesToUuid(head.subarray(0, 16)), expMs }
  } catch {
    return null
  }
}

/**
 * The link that goes in every recurring email and text. Null when the app has
 * no signing secret (self-host without a service-role key) — callers then just
 * omit the line rather than printing a link that 404s.
 */
export function notifyPrefsUrl(companyId: string): string | null {
  const t = createNotifyToken(companyId)
  return t ? `${BRAND_URL}/n/${t}` : null
}
