import { createHash } from 'crypto'

/**
 * Per-IP sliding-window limiter for the map's public proxy endpoints
 * (/api/route, /api/plane-info) — the same shape /api/mcp uses per key.
 *
 * Serverless honesty: each warm instance keeps its own window, so the real
 * global ceiling is (limit × instances)/min. That still ends what this
 * guards against: a scraper using hammertrack.ai as a free relay to the
 * keyless upstreams (OSRM's demo server bans heavy users BY SOURCE — abuse
 * relayed through us gets OUR egress blocked and kills the feature for
 * every real customer). Legitimate use is a person tapping a map.
 */

const WINDOW_MS = 60_000
const buckets = new Map<string, number[]>()
const BUCKET_CAP = 5000

/** True when this ip is over `limit` hits/minute for the given tag. */
export function ipRateLimited(req: { headers: { get(k: string): string | null } }, tag: string, limit = 30): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  // Hash so raw addresses never sit in process memory beyond the request.
  const id = tag + ':' + createHash('sha256').update(ip).digest('base64').slice(0, 16)
  const now = Date.now()
  const hits = (buckets.get(id) ?? []).filter((t) => now - t < WINDOW_MS)
  if (hits.length >= limit) {
    buckets.set(id, hits)
    return true
  }
  hits.push(now)
  buckets.set(id, hits)
  if (buckets.size > BUCKET_CAP) buckets.clear()
  return false
}
