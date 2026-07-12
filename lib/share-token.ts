import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Signed public-replay tokens: one asset, one time window, 7-day life.
 * The token IS the grant — no table, no migration; the server will only serve
 * the exact asset+window baked into a signature it minted itself.
 */

export interface SharePayload {
  assetId: string
  fromMs: number
  toMs: number
  /** Scrub position (0-1) the sender was looking at — recipient starts there. */
  t?: number
  expMs: number
}

function secret(): string | null {
  if (process.env.SHARE_LINK_SECRET) return process.env.SHARE_LINK_SECRET
  // Derived (never exposed) so shares work with zero extra env config.
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY
  return k ? createHmac('sha256', 'hammertrack-share-v1').update(k).digest('hex') : null
}

export function createShareToken(p: SharePayload): string | null {
  const s = secret()
  if (!s) return null
  const body = Buffer.from(JSON.stringify(p)).toString('base64url')
  const sig = createHmac('sha256', s).update(body).digest('base64url').slice(0, 32)
  return `${body}.${sig}`
}

export function verifyShareToken(token: string): SharePayload | null {
  const s = secret()
  if (!s) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const want = createHmac('sha256', s).update(body).digest('base64url').slice(0, 32)
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as SharePayload
    if (typeof p.assetId !== 'string' || !p.assetId) return null
    if (!Number.isFinite(p.fromMs) || !Number.isFinite(p.toMs) || p.toMs <= p.fromMs) return null
    if (!Number.isFinite(p.expMs) || p.expMs < Date.now()) return null
    return p
  } catch {
    return null
  }
}
