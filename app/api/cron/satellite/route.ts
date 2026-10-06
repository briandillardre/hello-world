import { NextRequest, NextResponse } from 'next/server'
import { cleanRing } from '@/lib/satellite/geo'
import type { Provider } from '@/lib/satellite/pricing'
import { collectPlanetOrders, runPlanetSite, runSentinelSite, type SatSub, type Site, type Tally } from '@/lib/satellite/run'
import { planetReady } from '@/lib/satellite/planet'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Stop starting new sites this long into the run (maxDuration is 300 s). */
const SOFT_DEADLINE_MS = 230_000
/** A site checked less than this long ago is someone else's (a retried cron, a second run). */
const CLAIM_MS = 20 * 60_000

/**
 * Daily satellite pictures for the sites that asked for them (migration 131).
 *
 * For each watched site of a company with the satellite add-on — oldest
 * check first, claimed with a compare-and-set so two runs never take the same
 * site — look for new clear passes and turn each into a dated, PLACED photo on
 * the site's timeline (lib/satellite/run.ts): Sentinel-2 every few days at
 * 10 m (free), or PlanetScope daily at 3 m when `PL_API_KEY` is set. Planet
 * orders take minutes; the ones placed earlier are collected at the end.
 * Bounded: a soft deadline, a site cap, and per-site caps inside the runner.
 *
 * Runs at 22:35 UTC: Sentinel-2 crosses the eastern US around 16:20 UTC and
 * Earth Search lists it a few hours later. Fails CLOSED on CRON_SECRET — it
 * spends free public services (and, with Planet on, money) on our behalf.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const started = Date.now()
  const deadline = started + SOFT_DEADLINE_MS
  const maxSites = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get('max')) || 40, 100))

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()

  const { data: subs, error } = await svc.from('zone_satellite')
    .select('zone_id, company_id, provider, enabled_at, last_scene_at, last_checked_at')
    .eq('enabled', true)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(maxSites)
  if (error) return NextResponse.json({ ok: true, skipped: 'pre-131 schema' })

  // The add-on is checked per company, once.
  const { satelliteAddonActive } = await import('@/lib/db/satellite')
  const addon = new Map<string, boolean>()
  for (const s of subs ?? []) {
    if (!addon.has(s.company_id)) addon.set(s.company_id, await satelliteAddonActive(s.company_id))
  }

  const ids = (subs ?? []).map((s) => s.zone_id)
  const zones = new Map<string, { company_id: string; kind: string | null; owner_id: string | null; geometry: { coordinates?: unknown[] } | null }>()
  if (ids.length) {
    const { data } = await svc.from('geofences_json').select('id, company_id, kind, owner_id, geometry').in('id', ids)
    for (const z of data ?? []) zones.set(z.id, z)
  }

  const results: { zone: string; provider: Provider; tally?: Tally; skipped?: string; error?: string }[] = []
  const finish = async (zoneId: string, patch: Record<string, unknown>) => {
    await svc.from('zone_satellite').update({ ...patch, updated_at: new Date().toISOString() }).eq('zone_id', zoneId)
  }

  for (const s of (subs ?? []) as (SatSub & { last_checked_at: string | null })[]) {
    if (Date.now() > deadline) break
    const zone = zones.get(s.zone_id)
    const ring = cleanRing(zone?.geometry?.coordinates?.[0])
    let skip: string | null = null
    if (!addon.get(s.company_id)) skip = 'Satellite add-on is off for this company.'
    else if (!zone || zone.company_id !== s.company_id) skip = 'Site not found.'
    else if (zone.kind === 'boundary' || zone.kind === 'vendor' || zone.owner_id) skip = 'Not a company site.'
    else if (!ring) skip = 'Site outline can’t be read.'
    else if (s.provider === 'planet' && !planetReady()) skip = 'Planet isn’t set up (no key).'
    if (skip) {
      // Stamped like a check, so a skipped site goes to the back of the queue
      // instead of taking a slot from a live one every night.
      await finish(s.zone_id, { last_checked_at: new Date().toISOString(), last_error: skip }).catch(() => {})
      results.push({ zone: s.zone_id, provider: s.provider, skipped: skip })
      continue
    }

    // Claim the site: only one run works on it at a time.
    const nowIso = new Date().toISOString()
    const { data: claimed } = await svc.from('zone_satellite')
      .update({ last_checked_at: nowIso })
      .eq('zone_id', s.zone_id).eq('enabled', true)
      .or(`last_checked_at.is.null,last_checked_at.lt."${new Date(Date.now() - CLAIM_MS).toISOString()}"`)
      .select('zone_id')
    if (!claimed?.length) {
      results.push({ zone: s.zone_id, provider: s.provider, skipped: 'checked moments ago' })
      continue
    }

    const site: Site = { id: s.zone_id, companyId: s.company_id, ring: ring! }
    try {
      const tally = s.provider === 'planet'
        ? await runPlanetSite(svc, s, site, deadline)
        : await runSentinelSite(svc, site, deadline)
      const patch: Record<string, unknown> = { last_error: null }
      if (tally.newest && (!s.last_scene_at || Date.parse(tally.newest) > Date.parse(s.last_scene_at))) patch.last_scene_at = tally.newest
      await finish(s.zone_id, patch)
      results.push({ zone: s.zone_id, provider: s.provider, tally })
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 280)
      console.error('satellite run failed for', s.zone_id, msg)
      await finish(s.zone_id, { last_error: msg }).catch(() => {})
      results.push({ zone: s.zone_id, provider: s.provider, error: msg })
    }
  }

  let planet: Awaited<ReturnType<typeof collectPlanetOrders>> | null = null
  if (planetReady() && Date.now() < started + 280_000) {
    try {
      planet = await collectPlanetOrders(svc, started + 280_000)
    } catch (e) {
      console.error('planet collect failed', e)
    }
  }

  const sum = (k: keyof Tally) => results.reduce((n, r) => n + (typeof r.tally?.[k] === 'number' ? (r.tally[k] as number) : 0), 0)
  return NextResponse.json({
    ok: true,
    sites: results.length,
    pictures: sum('pictures'),
    cloudy: sum('cloudy'),
    ordered: sum('ordered'),
    failed: sum('failed') + results.filter((r) => r.error).length,
    planet,
    ms: Date.now() - started,
    results,
  })
}
