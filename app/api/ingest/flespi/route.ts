import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { normalizeMessage, type FlespiMessage, type NormalizedReading } from '@/lib/flespi'
import { evaluateAlerts, pointInPolygon } from '@/lib/alerts-engine'
import type { Asset, AssetLocation, AlertRule, Geofence } from '@/lib/types'

const HMAC_SECRET = 'hammertrack-flespi-token-comparison'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

function verifyToken(request: NextRequest): boolean {
  const expected = process.env.FLESPI_WEBHOOK_TOKEN
  // Fail closed: with a real database but no webhook token configured,
  // reject rather than accept unauthenticated location writes.
  if (!expected) return isMock

  const token = request.headers.get('x-flespi-token') ?? ''
  if (!token) return false
  try {
    const a = createHmac('sha256', HMAC_SECRET).update(token).digest()
    const b = createHmac('sha256', HMAC_SECRET).update(expected).digest()
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!verifyToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // flespi posts either a single message or an array of messages.
  const messages: FlespiMessage[] = Array.isArray(body) ? body : [body as FlespiMessage]
  const normalized = messages.map(normalizeMessage).filter((r): r is NormalizedReading => r !== null)

  if (normalized.length === 0) {
    return NextResponse.json({ error: 'No valid messages (need ident + position)' }, { status: 422 })
  }

  if (isMock) {
    return NextResponse.json({
      ok: true,
      mode: 'demo',
      accepted: normalized.length,
      beacons_seen: normalized.reduce((n, r) => n + r.beacons.length, 0),
      message: 'Demo mode: flespi data parsed (not persisted)',
    })
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()

  let persisted = 0
  // company_id -> latest reading per updated asset, for alert evaluation below
  const updated = new Map<string, Map<string, NormalizedReading>>()
  // asset_id -> the fix on record BEFORE this batch, for edge-triggered zone
  // alerts (left/entered = a transition, not a state — otherwise a truck
  // driving around town re-fires "left site" every dedupe window all day).
  const prevFix = new Map<string, { lat: number; lng: number }>()
  for (const r of normalized) {
    const { data: asset } = await supabase
      .from('assets')
      .select('id, company_id')
      .eq('tracker_id', r.tracker_id)
      .single()
    if (!asset) continue

    if (!prevFix.has(asset.id)) {
      const { data: prev } = await supabase
        .from('asset_locations')
        .select('lat, lng')
        .eq('asset_id', asset.id)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (prev) prevFix.set(asset.id, prev)
    }

    await supabase.from('asset_locations').insert({
      asset_id: asset.id,
      company_id: asset.company_id,
      lat: r.lat,
      lng: r.lng,
      speed: r.speed,
      heading: r.heading,
      battery: r.battery,
      accuracy: null,
      timestamp: r.timestamp,
      // Full telemetry (OBD PIDs, ignition, voltages, DTCs, events…) so
      // nothing the tracker reports is discarded — the asset page and future
      // maintenance/utilization features read from here.
      raw: { source: 'flespi', ...r.params },
    })
    persisted++
    if (!updated.has(asset.company_id)) updated.set(asset.company_id, new Map())
    updated.get(asset.company_id)!.set(asset.id, r)

    // Associate detected BLE beacons (tools) with this gateway asset.
    // Convention: a tool asset's `tracker_id` is set to its BLE beacon ID/MAC
    // (the same value the gateway reports in ble.beacons[].id). Register tools
    // with their beacon UUID as the tracker_id for this lookup to match.
    for (const beacon of r.beacons) {
      const { data: tool } = await supabase
        .from('assets')
        .select('id')
        .eq('company_id', asset.company_id)
        .eq('tracker_id', beacon.id)
        .single()
      if (!tool) continue
      await supabase.from('tool_associations').upsert(
        {
          company_id: asset.company_id,
          tool_asset_id: tool.id,
          gateway_asset_id: asset.id,
          rssi: beacon.rssi,
          last_seen: r.timestamp,
        },
        { onConflict: 'tool_asset_id' }
      )
    }
  }

  // ── Alert rules: evaluate against the fresh readings ──────────────────────
  // Theft ("after-hours movement"), left-site, enter/exit. Fires here, on real
  // telemetry, with a 60-min dedupe per (rule, asset) so a moving truck doesn't
  // page the owner on every ping. Failures never break ingestion.
  let alertsFired = 0
  try {
    for (const [companyId, byAsset] of Array.from(updated.entries())) {
      const [{ data: rules }, { data: fences }, { data: companyRow }, { data: assetRows }] = await Promise.all([
        supabase.from('alert_rules').select('*').eq('company_id', companyId).eq('active', true),
        supabase.from('geofences_json').select('*').eq('company_id', companyId),
        supabase.from('companies').select('name, work_start, work_end, work_days, alert_phone, alert_email').eq('id', companyId).single(),
        supabase.from('assets').select('*').eq('company_id', companyId).eq('active', true),
      ])
      if (!rules?.length || !companyRow || !assetRows?.length) continue
      const notifyBatch: { reason: string; severity: 'critical' | 'warning' | 'info' }[] = []

      const targets = (assetRows as Asset[]).filter((a) => byAsset.has(a.id))
      const locations: Record<string, AssetLocation> = {}
      for (const a of targets) {
        const r = byAsset.get(a.id)!
        locations[a.id] = {
          id: '', asset_id: a.id, company_id: companyId,
          lat: r.lat, lng: r.lng, accuracy: null, battery: r.battery,
          speed: r.speed, heading: r.heading, timestamp: r.timestamp, raw: null,
        }
      }

      const fired = evaluateAlerts({
        assets: targets,
        locations,
        rules: rules as AlertRule[],
        geofences: (fences ?? []) as Geofence[],
        company: companyRow,
      })

      for (const f of fired) {
        // Zone-boundary triggers fire only on the TRANSITION across the edge.
        if (f.trigger === 'enter' || f.trigger === 'exit' || f.trigger === 'left_site') {
          const fence = (fences ?? []).find((g: { id: string }) => g.id === f.geofence_id) as Geofence | undefined
          const prev = prevFix.get(f.asset_id)
          const cur = byAsset.get(f.asset_id)
          if (!fence || !prev || !cur) continue
          const ring = fence.geometry.coordinates[0] as [number, number][]
          const wasInside = pointInPolygon([prev.lng, prev.lat], ring)
          const isInside = pointInPolygon([cur.lng, cur.lat], ring)
          if (f.trigger === 'enter' ? !( !wasInside && isInside ) : !( wasInside && !isInside )) continue
        }
        const sinceIso = new Date(Date.now() - 60 * 60_000).toISOString()
        const { data: recent } = await supabase
          .from('alert_events')
          .select('id')
          .eq('rule_id', f.rule_id)
          .eq('asset_id', f.asset_id)
          .gte('triggered_at', sinceIso)
          .limit(1)
        if (recent?.length) continue
        await supabase.from('alert_events').insert({
          company_id: companyId, rule_id: f.rule_id, asset_id: f.asset_id,
        })
        alertsFired++
        notifyBatch.push({ reason: f.reason, severity: f.severity })
      }

      // Text/webhook the owner for freshly-fired alerts (no-op unless Twilio /
      // webhook env vars are set). Never let delivery break ingestion.
      if (notifyBatch.length) {
        try {
          const { dispatchAlerts } = await import('@/lib/notify')
          const co = companyRow as { name?: string; alert_phone?: string; alert_email?: string }
          await dispatchAlerts(co.name ?? 'Your fleet', { phone: co.alert_phone, email: co.alert_email }, notifyBatch)
        } catch (err) {
          console.error('alert dispatch failed', err)
        }
      }
    }
  } catch (err) {
    console.error('alert evaluation failed', err)
  }

  return NextResponse.json({ ok: true, persisted, alerts: alertsFired })
}
