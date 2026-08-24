import { NextResponse } from 'next/server'
import { isPlatformOwner } from '@/lib/platform-owner'
import { SEED_ZONES, SEED_ASSETS, irregularRing } from '@/lib/sim/seed'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Turn the CALLER's company into the showroom (Brian, Aug 23: "I want the
 * simulator company as the example so I can make it what it needs to be").
 * Founder-gated; refuses to touch a company that already has real (non-sim)
 * assets so it can never run against DCG. Idempotent: re-running fills in
 * whatever is missing and never duplicates.
 */
export async function POST() {
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 400 })
  if (!(await isPlatformOwner())) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { getCurrentCompanyId } = await import('@/lib/db/company')
  const companyId = await getCurrentCompanyId()
  if (!companyId) return NextResponse.json({ error: 'no company' }, { status: 400 })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()

  // Never convert a company with real assets. NULL tracker_id rows count as
  // real too — the app legitimately creates assets before hardware arrives,
  // and NOT LIKE is NULL for NULL (sec-check).
  const { data: real } = await svc
    .from('assets')
    .select('id')
    .eq('company_id', companyId)
    .or('tracker_id.is.null,tracker_id.not.like.sim-%')
    .limit(1)
  if (real?.length) {
    return NextResponse.json(
      { error: 'This company has real assets — create a FRESH account for the showroom and seed that one.' },
      { status: 409 }
    )
  }

  // Zones (match by name so re-seeding never duplicates).
  const { data: existingZones } = await svc.from('geofences').select('id, name, kind').eq('company_id', companyId)
  const zoneByName = new Map((existingZones ?? []).map((z) => [z.name as string, z]))
  let zonesAdded = 0
  for (let i = 0; i < SEED_ZONES.length; i++) {
    const z = SEED_ZONES[i]
    if (zoneByName.has(z.name)) continue
    const ring = irregularRing(z.c[0], z.c[1], z.radiusM, 0x9e3779b9 + i * 977)
    const { data: inserted, error } = await svc.from('geofences').insert({
      company_id: companyId, name: z.name, color: z.color, kind: z.kind,
      geometry: { type: 'Polygon', coordinates: [ring] },
    }).select('id, name, kind').single()
    if (error) return NextResponse.json({ error: `zone ${z.name}: ${error.message}` }, { status: 500 })
    if (inserted) zoneByName.set(z.name, inserted)
    zonesAdded++
  }

  // Assets (match by tracker_id). Tracker ids carry a per-company suffix —
  // the bare seed constants are public in this repo, and the flespi ingest
  // resolves idents globally, so another tenant registering 'sim-truck-1'
  // could collide the showroom's feed (sec-check). Company-derived, so
  // re-seeding stays idempotent.
  const suffix = companyId.replace(/-/g, '').slice(0, 6)
  const withSuffix = (t: string) => `${t}-${suffix}`
  const { data: existingAssets } = await svc.from('assets').select('id, tracker_id').eq('company_id', companyId)
  const assetByTracker = new Map((existingAssets ?? []).map((a) => [a.tracker_id as string, a]))
  let assetsAdded = 0
  for (const a of SEED_ASSETS) {
    const tracker = withSuffix(a.tracker_id)
    if (assetByTracker.has(tracker)) continue
    // Tool carriers reference their truck's tracker id — suffix those too.
    const sim = (a.metadata.sim ?? {}) as Record<string, unknown>
    const metadata = sim.carrier
      ? { ...a.metadata, sim: { ...sim, carrier: withSuffix(String(sim.carrier)) } }
      : a.metadata
    const { data: inserted, error } = await svc.from('assets').insert({
      company_id: companyId, name: a.name, type: a.type, tracker_id: tracker,
      metadata, active: true,
      daily_cost: a.daily_cost ?? null, hourly_rate: a.hourly_rate ?? null,
    }).select('id, tracker_id').single()
    if (error) return NextResponse.json({ error: `asset ${a.name}: ${error.message}` }, { status: 500 })
    if (inserted) assetByTracker.set(tracker, inserted)
    assetsAdded++
  }

  // Zone-wide alert rules on the site zones — theft + left-site are the
  // demo's marquee moments, so they're armed from day one.
  const { data: existingRules } = await svc.from('alert_rules').select('geofence_id, trigger').eq('company_id', companyId)
  const haveRule = new Set((existingRules ?? []).map((r) => `${r.geofence_id}|${r.trigger}`))
  let rulesAdded = 0
  for (const z of SEED_ZONES.filter((s) => s.kind === 'site')) {
    const zone = zoneByName.get(z.name)
    if (!zone) continue
    for (const trigger of ['after_hours_movement', 'left_site'] as const) {
      if (haveRule.has(`${zone.id}|${trigger}`)) continue
      await svc.from('alert_rules').insert({
        company_id: companyId, geofence_id: zone.id, asset_id: null, trigger, idle_minutes: null, active: true,
      })
      rulesAdded++
    }
  }

  // One overdue service so the wrench badge / maintenance story shows.
  const exc = assetByTracker.get(withSuffix('sim-exc-1'))
  if (exc) {
    const { data: sched } = await svc.from('maintenance_schedules').select('id').eq('asset_id', exc.id).limit(1)
    if (!sched?.length) {
      await svc.from('maintenance_schedules').insert({
        company_id: companyId, asset_id: exc.id,
        interval_type: 'engine_hours', interval_value: 250, last_service_value: 3890,
        last_service_date: new Date(Date.now() - 55 * 86_400_000).toISOString(),
        description: 'Hydraulic fluid & filter service',
      })
    }
  }

  const { error: coErr } = await svc.from('companies').update({ simulated: true }).eq('id', companyId)
  if (coErr) return NextResponse.json({ error: `mark simulated: ${coErr.message}` }, { status: 500 })

  return NextResponse.json({
    ok: true, zonesAdded, assetsAdded, rulesAdded,
    note: 'Simulator picks this up on its next run (within ~5 min) and backfills the last 6 hours.',
  })
}
