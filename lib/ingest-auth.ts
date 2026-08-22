import type { NextRequest } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Shared x-api-key auth for the direct ingest endpoints
 * (/api/ingest/obd2 + /api/ingest/location — NOT flespi, which is token-based).
 *
 * Two credentials are accepted:
 *  1. The platform INGEST_API_KEY env (timing-safe compare, unchanged since
 *     day one) → unscoped: asset resolution behaves exactly as before, so
 *     existing devices keep working.
 *  2. A per-company key (companies.api_key, UNIQUE-indexed) → the ingest is
 *     scoped to that company: asset lookups must also match company_id, so
 *     customer #2's key can never write onto customer #1's assets.
 */

const HMAC_SECRET = 'hammertrack-api-key-comparison'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export type IngestAuth =
  /** companyId null = platform key (or demo mode) — today's unscoped behavior. */
  | { ok: true; companyId: string | null }
  | { ok: false }

export async function verifyIngestKey(request: NextRequest): Promise<IngestAuth> {
  // Demo mode accepts unauthenticated posts (nothing is persisted).
  if (isMock) return { ok: true, companyId: null }

  const key = request.headers.get('x-api-key') ?? ''
  if (!key) return { ok: false }

  // 1. Platform key — dedicated ingest credential, never the Supabase
  //    service-role key (which would hand every tracker integration full
  //    database access). Timing-safe via HMAC-then-compare.
  const platform = process.env.INGEST_API_KEY
  if (platform) {
    try {
      const hashA = createHmac('sha256', HMAC_SECRET).update(key).digest()
      const hashB = createHmac('sha256', HMAC_SECRET).update(platform).digest()
      if (timingSafeEqual(hashA, hashB)) return { ok: true, companyId: null }
    } catch {
      // fall through to the company-key lookup
    }
  }

  // 2. Per-company key — exact match against the UNIQUE-indexed
  //    companies.api_key column via the service client. An unknown key fails
  //    closed; nothing about the presented key is ever logged.
  const companyId = await lookupCompanyByKey(key)
  if (companyId) return { ok: true, companyId }

  return { ok: false }
}

/**
 * Resolve a per-company API key (companies.api_key, UNIQUE-indexed) to its
 * company id via the service client. Returns null for an unknown key or an
 * unavailable DB (fail closed); nothing about the presented key is logged.
 * Shared by ingest auth above and the MCP Agent Interface (/api/mcp) — which
 * accepts ONLY company keys, never the platform INGEST_API_KEY.
 */
export async function lookupCompanyByKey(key: string): Promise<string | null> {
  // Shape gate: real keys are tf_ + base36 (generateApiKey). Garbage keys
  // get rejected here instead of costing a DB query each (ship-check P2).
  if (!/^tf_[a-z0-9_]{10,64}$/i.test(key)) return null
  if (!key) return null
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { data } = await createServiceClient()
      .from('companies')
      .select('id')
      .eq('api_key', key)
      .maybeSingle()
    if (data?.id) return data.id as string
  } catch {
    // DB unavailable → fail closed
  }
  return null
}
