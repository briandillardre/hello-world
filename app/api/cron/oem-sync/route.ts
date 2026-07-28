import { NextRequest, NextResponse } from 'next/server'
import { fetchAempFleet, type OemConnectionConfig } from '@/lib/aemp-client'
import { applyAempReadings } from '@/lib/aemp-ingest'
import type { OemConnection } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * OEM telematics pull — runs on Vercel cron. Every enabled oem_connections row
 * is an ISO 15143-3 (AEMP 2.0) Fleet feed (Komatsu/KOMTRAX, Link-Belt/RemoteCARE,
 * Cat/VisionLink, …). We fetch each, normalize, and map machines to HammerTrack
 * assets by serial — so OEM equipment shows on the same map/timeline and its
 * engine hours feed the maintenance meters, with zero on-machine hardware.
 *
 * OEM snapshots refresh on the order of minutes-to-hours, so a 2-hourly pull is
 * plenty (and stays well under any dealer rate limits). One feed failing (bad
 * creds, dealer outage) records its own last_status and never blocks the others.
 *
 * Manual test: GET /api/cron/oem-sync with `Authorization: Bearer $CRON_SECRET`.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()

  const { data: conns, error } = await supabase
    .from('oem_connections')
    .select('*')
    .eq('enabled', true)
  if (error) {
    // Table not migrated yet (pre-024) — no-op rather than 500 the cron.
    return NextResponse.json({ ok: true, skipped: 'oem_connections unavailable', detail: error.message })
  }
  if (!conns?.length) return NextResponse.json({ ok: true, connections: 0 })

  const summary: Record<string, unknown>[] = []
  let totalMatched = 0
  const unmatchedByCompany = new Map<string, { equipmentId: string | null; serial: string | null; oem: string | null }[]>()

  for (const c of conns as OemConnection[]) {
    const conf: OemConnectionConfig = {
      provider: (c.provider as OemConnectionConfig['provider']) ?? 'custom',
      base_url: c.base_url,
      auth_type: c.auth_type,
      username: c.username,
      secret: c.secret,
      header_name: c.header_name,
      token_url: c.token_url,
    }
    try {
      const { readings, pages } = await fetchAempFleet(conf)
      const result = await applyAempReadings(supabase, c.company_id, c.provider, readings)
      totalMatched += result.matched
      if (result.unmatched.length) {
        const prev = unmatchedByCompany.get(c.company_id) ?? []
        unmatchedByCompany.set(c.company_id, prev.concat(result.unmatched))
      }
      await supabase.from('oem_connections').update({
        last_sync: new Date().toISOString(),
        last_status: `ok: ${result.matched} matched / ${readings.length} reported (${pages} page${pages === 1 ? '' : 's'})`,
        last_count: result.matched,
      }).eq('id', c.id)
      summary.push({ id: c.id, provider: c.provider, reported: readings.length, ...result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      await supabase.from('oem_connections').update({ last_status: `error: ${msg}` }).eq('id', c.id)
      summary.push({ id: c.id, provider: c.provider, error: msg })
    }
  }

  // Tell the owner once per run about machines the OEM is reporting that aren't
  // registered in HammerTrack yet — that's the actionable "link this machine"
  // nudge (dedup handled by the daily cadence, not per-machine spam).
  try {
    if (unmatchedByCompany.size) {
      const { dispatchAlerts } = await import('@/lib/notify')
      for (const [companyId, list] of Array.from(unmatchedByCompany.entries())) {
        const uniq = Array.from(new Map(list.map((u) => [u.serial ?? u.equipmentId ?? '?', u])).values())
        const names = uniq.slice(0, 6).map((u) => `${u.oem ?? ''} ${u.serial ?? u.equipmentId ?? '?'}`.trim()).join(', ')
        const { data: co } = await supabase
          .from('companies').select('name, alert_email').eq('id', companyId).single()
        await dispatchAlerts(co?.name ?? 'Your fleet', { email: co?.alert_email }, [{
          severity: 'info',
          reason: `${uniq.length} OEM machine${uniq.length === 1 ? '' : 's'} reporting but not registered: ${names}. Add them in HammerTrack with tracker_id aemp:<serial>.`,
        }], companyId)
      }
    }
  } catch { /* notify is best-effort */ }

  return NextResponse.json({ ok: true, connections: conns.length, matched: totalMatched, summary })
}
