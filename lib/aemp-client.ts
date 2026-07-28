/**
 * ISO 15143-3 fetch client + OEM provider presets. Server-only.
 *
 * A connection is `{ base_url, auth_type, username, secret, header_name }`.
 * base_url points at page 1 of the OEM's Fleet endpoint; we follow the
 * `Links[].Next` chain to the last page. Every OEM provisions the base URL and
 * credentials per-customer through their dealer portal — the presets below
 * carry the auth style + where to get the keys, not secrets.
 */

import { parseAempFleet, nextLink, type AempReading } from './aemp'

export type OemProvider = 'komatsu' | 'linkbelt' | 'cat' | 'cnh' | 'bomag' | 'wirtgen' | 'custom'
export type OemAuthType = 'basic' | 'bearer' | 'apikey' | 'oauth'

export interface OemConnectionConfig {
  provider: OemProvider
  base_url: string
  auth_type: OemAuthType
  username?: string | null
  secret?: string | null
  /** Header name for apikey auth (default `x-api-key`). */
  header_name?: string | null
  /** OAuth2 token endpoint (auth_type 'oauth') — e.g. KOMTRAX /provider/token. */
  token_url?: string | null
}

export interface OemPreset {
  id: OemProvider
  label: string
  /** Telematics platform brand the contractor already logs into. */
  platform: string
  authType: OemAuthType
  /** Known public Fleet endpoint, if any — else the customer provisions it. */
  defaultBaseUrl?: string
  /** Where the contractor requests API access / credentials. */
  docsUrl: string
  note: string
}

/**
 * Order reflects the DCG rollout: Komatsu + Link-Belt first (Brian's fleet),
 * then the rest of the confirmed ISO 15143-3 OEMs.
 */
export const OEM_PRESETS: OemPreset[] = [
  {
    id: 'komatsu',
    label: 'Komatsu',
    platform: 'My Komatsu / KOMTRAX',
    authType: 'oauth',
    docsUrl: 'https://www.mykomatsu.komatsu',
    note: 'Request the ISO 15143-3 (AEMP 2.0) API via your dealer / My Komatsu. Komatsu issues a Fleet URL, an account + password, and a TOKEN URL (isoapi.komtrax.komatsu/provider/token) — OAuth, not plain basic auth.',
  },
  {
    id: 'linkbelt',
    label: 'Link-Belt',
    platform: 'RemoteCARE (ORBCOMM)',
    authType: 'basic',
    docsUrl: 'https://www.linkbelt.com/remotecare',
    note: 'RemoteCARE telemetry is served through ORBCOMM. Ask your Link-Belt dealer to enable the ISO 15143-3 feed; ORBCOMM returns a Fleet URL + credentials.',
  },
  {
    id: 'cat',
    label: 'Caterpillar',
    platform: 'VisionLink / Product Link',
    authType: 'basic',
    defaultBaseUrl: 'https://api.cat.com/telematics/iso15143/fleet/1',
    docsUrl: 'https://digital.cat.com/apis/products/prod/iso-15143-3-aemp-20-api',
    note: 'Cat Digital marketplace. Covers Cat product lines incl. Weiler pavers (Cat dealer product).',
  },
  {
    id: 'cnh',
    label: 'New Holland / CNH',
    platform: 'FleetForce',
    authType: 'basic',
    docsUrl: 'https://www.cnhindustrial.com',
    note: 'CNH FleetForce exposes AEMP 2.0; dealer enables the feed.',
  },
  {
    id: 'bomag',
    label: 'Bomag',
    platform: 'Bomag Telematic',
    authType: 'basic',
    docsUrl: 'https://www.bomag.com/telematic',
    note: 'Requires an active Telematic subscription on the machine.',
  },
  {
    id: 'wirtgen',
    label: 'Wirtgen / Hamm',
    platform: 'WITOS',
    authType: 'basic',
    docsUrl: 'https://www.wirtgen-group.com/witos',
    note: 'Only machines with a WITOS-Ready TCU report — a plain HD12VV does not.',
  },
  {
    id: 'custom',
    label: 'Other (generic ISO 15143-3)',
    platform: 'Any AEMP 2.0 feed',
    authType: 'basic',
    docsUrl: 'https://www.aem.org/standards/iso15143/3',
    note: 'Any OEM or aggregator that serves a standard ISO 15143-3 Fleet endpoint.',
  },
]

export function presetFor(provider: string): OemPreset | undefined {
  return OEM_PRESETS.find((p) => p.id === provider)
}

// OAuth2 access-token cache — KOMTRAX-style feeds mint short-lived bearer
// tokens from a token URL. Keyed per connection; refreshed 60s before expiry.
// Module-level is fine: the cron runs in one lambda per invocation, and a cold
// start just re-fetches.
const tokenCache = new Map<string, { token: string; exp: number }>()

async function fetchOauthToken(conn: OemConnectionConfig): Promise<string> {
  const tokenUrl = conn.token_url
  if (!tokenUrl) throw new Error(`${conn.provider}: auth_type 'oauth' requires token_url`)
  const key = `${tokenUrl}|${conn.username ?? ''}`
  const hit = tokenCache.get(key)
  if (hit && Date.now() < hit.exp) return hit.token
  const id = conn.username ?? ''
  const secret = conn.secret ?? ''
  const basic = Buffer.from(`${id}:${secret}`, 'utf8').toString('base64')
  // Grant flavor differs by provider — try the credentials as an OAuth client
  // (basic header, then body), then as a resource-owner password grant.
  const attempts: { headers: Record<string, string>; body: string }[] = [
    { headers: { Authorization: `Basic ${basic}` }, body: 'grant_type=client_credentials' },
    { headers: {}, body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}` },
    { headers: {}, body: `grant_type=password&username=${encodeURIComponent(id)}&password=${encodeURIComponent(secret)}` },
  ]
  let lastErr = 'no attempts ran'
  for (const a of attempts) {
    let res: Response
    try {
      res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...a.headers },
        body: a.body,
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      })
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      continue
    }
    if (!res.ok) { lastErr = `token HTTP ${res.status}`; continue }
    const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number | string } | null
    if (j?.access_token) {
      const ttl = Math.max(120, Math.min(24 * 3600, Number(j.expires_in) || 3600))
      tokenCache.set(key, { token: j.access_token, exp: Date.now() + (ttl - 60) * 1000 })
      return j.access_token
    }
    lastErr = 'token response missing access_token'
  }
  throw new Error(`${conn.provider} OAuth token fetch failed (${lastErr})`)
}

async function authHeaders(conn: OemConnectionConfig): Promise<Record<string, string>> {
  const h: Record<string, string> = { Accept: 'application/json' }
  const secret = conn.secret ?? ''
  switch (conn.auth_type) {
    case 'basic': {
      const raw = `${conn.username ?? ''}:${secret}`
      h.Authorization = `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
      break
    }
    case 'bearer':
      h.Authorization = `Bearer ${secret}`
      break
    case 'apikey':
      h[conn.header_name || 'x-api-key'] = secret
      break
    case 'oauth':
      h.Authorization = `Bearer ${await fetchOauthToken(conn)}`
      break
  }
  return h
}

export interface AempFetchResult {
  readings: AempReading[]
  pages: number
}

/**
 * Fetch every page of an OEM Fleet feed and return normalized readings.
 * OEM feeds are lower-frequency snapshots (minutes–hours), so this runs on a
 * cron, not the request path. Throws on a non-2xx page so the caller can record
 * `last_status` and page the owner.
 */
export async function fetchAempFleet(conn: OemConnectionConfig): Promise<AempFetchResult> {
  const headers = await authHeaders(conn)
  const readings: AempReading[] = []
  let url: string | null = conn.base_url
  let pages = 0
  const MAX_PAGES = 100 // ISO 15143-3 pages ~ hundreds of machines; a real cap, not a limit any DCG-scale fleet hits
  const seen = new Set<string>()

  while (url && pages < MAX_PAGES) {
    if (seen.has(url)) break // defensive: never re-fetch a page a feed points back to
    seen.add(url)
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000), cache: 'no-store' })
    if (!res.ok) {
      throw new Error(`${conn.provider} AEMP HTTP ${res.status} on page ${pages + 1}`)
    }
    const json: unknown = await res.json()
    readings.push(...parseAempFleet(json))
    pages++
    url = nextLink(json, url)
  }

  return { readings, pages }
}
