import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { normalizeMessage, type FlespiMessage, type NormalizedReading } from '@/lib/flespi'
import { evaluateAlerts, pointInPolygon } from '@/lib/alerts-engine'
import { vehiclePower } from '@/lib/vehicle-power'
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

    const locRow = {
      asset_id: asset.id,
      company_id: asset.company_id,
      lat: r.lat,
      lng: r.lng,
      speed: r.speed,
      heading: r.heading,
      altitude: r.altitude,
      battery: r.battery,
      accuracy: null,
      timestamp: r.timestamp,
      // Full telemetry (OBD PIDs, ignition, voltages, DTCs, events…) so
      // nothing the tracker reports is discarded — the asset page and future
      // maintenance/utilization features read from here.
      raw: { source: 'flespi', ...r.params },
    }
    // Engine state as a REAL column (034) so the idle math can select it
    // cheaply — idle must mean engine ON, not merely device-awake.
    const ignition = vehiclePower(locRow.raw).engineOn
    let { error: locErr } = await supabase.from('asset_locations').insert({ ...locRow, ignition })
    // Retry without the column ONLY on a pre-034 schema (undefined column /
    // stale schema cache). Any other failure is real — retrying it masked
    // RLS/data errors and `persisted` over-counted (code review, Jul 21).
    if (locErr && (locErr.code === '42703' || locErr.code === 'PGRST204')) {
      ;({ error: locErr } = await supabase.from('asset_locations').insert(locRow))
    }
    if (locErr) {
      // Beacon association below still runs — tools shouldn't lose their
      // last-seen because one location row bounced.
      console.error(`flespi: asset_locations insert failed for ${asset.id}: ${locErr.code} ${locErr.message}`)
    } else {
      persisted++
      if (!updated.has(asset.company_id)) updated.set(asset.company_id, new Map())
      updated.get(asset.company_id)!.set(asset.id, r)
    }

    // Associate detected BLE beacons (tools) with this gateway asset.
    // Convention: a tool asset's `tracker_id` is set to its BLE beacon ID/MAC
    // (the same value the gateway reports in ble.beacons[].id). Register tools
    // with their beacon UUID as the tracker_id for this lookup to match.
    for (const beacon of r.beacons) {
      // Identity tolerance. Trackers report tags two ways depending on
      // config: hardware MAC ("DC:0D:04:BB:00:3A") or iBeacon identity
      // ("FDA50693-…:2751:65C1" — and note major/minor arrive in HEX while
      // every beacon app displays DECIMAL, e.g. 2751:65C1 = 10065:26049).
      // Build candidate forms and match each case/separator-insensitively,
      // so the owner can register a tool with whatever their scanner shows.
      const strip = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase()
      const candidates = [beacon.id]
      const ib = beacon.id.match(/^(.*):([0-9a-fA-F]{1,4}):([0-9a-fA-F]{1,4})$/)
      if (ib) candidates.push(`${ib[1]}:${parseInt(ib[2], 16)}:${parseInt(ib[3], 16)}`)

      let toolId: string | null = null
      for (const cand of candidates) {
        const { data: tool } = await supabase
          .from('assets')
          .select('id')
          .eq('company_id', asset.company_id)
          .ilike('tracker_id', cand)
          .limit(1)
          .maybeSingle()
        if (tool) { toolId = tool.id; break }
      }
      if (!toolId) {
        const bare = candidates.map(strip).filter((s) => s.length >= 8)
        if (bare.length) {
          const { data: tools } = await supabase
            .from('assets')
            .select('id, tracker_id')
            .eq('company_id', asset.company_id)
            .eq('type', 'tool')
            .not('tracker_id', 'is', null)
          const hit = (tools ?? []).find((t) => bare.includes(strip(String(t.tracker_id))))
          toolId = hit?.id ?? null
        }
      }
      if (!toolId) continue

      // ── Strongest-signal arbitration ─────────────────────────────────────
      // Two trucks parked side by side BOTH hear every tag (BLE carries
      // 30-100+ ft), and "last reporter wins" put Tool A in the wrong truck
      // overnight (Jul 14). The truck that hears a tag LOUDEST is holding it:
      // in-cab reads ~-50 dBm, the truck next door ~-85. A challenger only
      // takes the tool if it beats the current holder's signal by a clear
      // margin (hysteresis stops yard-flapping), or the holder's sighting
      // has gone stale (engine-off units check in ~hourly — 3h = well past
      // two missed check-ins, the holder likely no longer sees it at all).
      const seenMs = new Date(r.timestamp).getTime()
      const { data: cur } = await supabase
        .from('tool_associations')
        .select('gateway_asset_id, rssi, last_seen')
        .eq('tool_asset_id', toolId)
        .maybeSingle()
      if (cur && cur.gateway_asset_id !== asset.id) {
        const holderFresh = seenMs - new Date(cur.last_seen).getTime() < 3 * 3_600_000
        const HYSTERESIS_DB = 6
        const outshouts = typeof beacon.rssi === 'number' && typeof cur.rssi === 'number' &&
          beacon.rssi > cur.rssi + HYSTERESIS_DB
        if (holderFresh && !outshouts) continue // current holder keeps it
      }

      // Newer columns (tag_battery 022; last_lat/lng + attached_since 033)
      // degrade gracefully — retry with the legacy row so ingestion never
      // breaks on a not-yet-migrated database.
      const legacyRow: Record<string, unknown> = {
        company_id: asset.company_id,
        tool_asset_id: toolId,
        gateway_asset_id: asset.id,
        rssi: beacon.rssi,
        last_seen: r.timestamp,
      }
      const assocRow: Record<string, unknown> = {
        ...legacyRow,
        // The gateway's fix at THIS sighting = the tag's true last-seen spot.
        // A stale tag renders here, not wherever the carrier drove afterwards.
        last_lat: r.lat,
        last_lng: r.lng,
        // New ride (or first sighting) starts the dwell clock; same holder
        // keeps its original attach time (column omitted → value preserved).
        ...(!cur || cur.gateway_asset_id !== asset.id ? { attached_since: r.timestamp } : {}),
        ...(beacon.battery != null ? { tag_battery: beacon.battery } : {}),
      }
      const { error: assocErr } = await supabase.from('tool_associations').upsert(assocRow, { onConflict: 'tool_asset_id' })
      if (assocErr) {
        await supabase.from('tool_associations').upsert(legacyRow, { onConflict: 'tool_asset_id' })
      }

      // Pairing history (migration 021). tool_associations only holds the
      // CURRENT ride; this log keeps episodes (started→ended) so "which truck
      // had the laser level last Tuesday" is queryable. Open/extend/close as
      // the beacon moves between gateways; best-effort — a missing table or
      // write error must never break ingestion.
      try {
        const { data: open } = await supabase
          .from('pairing_log')
          .select('id, carrier_asset_id, last_seen')
          .eq('member_asset_id', toolId)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        // Unseen for 6h+ = that ride ended (engine-off units check in ~hourly,
        // so a normal overnight gap stays one episode).
        const GAP_MS = 6 * 3_600_000
        const stale = open ? seenMs - new Date(open.last_seen).getTime() > GAP_MS : false
        if (open && open.carrier_asset_id === asset.id && !stale) {
          await supabase.from('pairing_log').update({ last_seen: r.timestamp }).eq('id', open.id)
        } else {
          if (open) await supabase.from('pairing_log').update({ ended_at: open.last_seen }).eq('id', open.id)
          await supabase.from('pairing_log').insert({
            company_id: asset.company_id,
            kind: 'tool',
            member_asset_id: toolId,
            carrier_asset_id: asset.id,
            started_at: r.timestamp,
            last_seen: r.timestamp,
          })
        }
      } catch { /* pairing log is additive; ingestion continues regardless */ }
    }
  }

  // ── Vehicle health: fuel low + 12V battery weak, straight from telemetry ──
  // No geofence rule involved (migration 022: rule_id nullable + kind).
  // Dedupe 12h per (asset, kind) so a low tank pages once, not every ping.
  try {
    for (const [companyId, byAsset] of Array.from(updated.entries())) {
      const healthNotes: { reason: string; severity: 'critical' | 'warning' | 'info' }[] = []
      for (const [assetId, r] of Array.from(byAsset.entries())) {
        const checks: { kind: string; reason: string; severity: 'warning' | 'critical' }[] = []
        // Fuel level: Teltonika OBD reports percent under a few names.
        let fuelPct: number | null = null
        for (const [k, v] of Object.entries(r.params)) {
          if (/fuel[._ ]?level/i.test(k) && typeof v === 'number' && v >= 0 && v <= 100) { fuelPct = v; break }
        }
        if (fuelPct != null && fuelPct <= 15) {
          checks.push({ kind: 'fuel_low', reason: `Fuel low — ${Math.round(fuelPct)}%`, severity: fuelPct <= 8 ? 'critical' : 'warning' })
        }
        // 12V battery: external/OBD voltage in volts (mV variants normalized
        // by dividing when the number is implausibly large).
        for (const k of ['external.powersource.voltage', 'battery.current.voltage', 'obd.battery.voltage']) {
          const raw = r.params[k]
          if (typeof raw !== 'number') continue
          const volts = raw > 100 ? raw / 1000 : raw
          if (volts > 5 && volts < 11.8) {
            checks.push({ kind: 'battery_low', reason: `12V battery weak — ${volts.toFixed(1)} V`, severity: volts < 11.4 ? 'critical' : 'warning' })
          }
          break
        }
        for (const c of checks) {
          const sinceIso = new Date(Date.now() - 12 * 3_600_000).toISOString()
          const { data: recent } = await supabase
            .from('alert_events')
            .select('id')
            .eq('asset_id', assetId)
            .eq('kind', c.kind)
            .gte('triggered_at', sinceIso)
            .limit(1)
          if (recent?.length) continue
          const { error } = await supabase.from('alert_events').insert({
            company_id: companyId, asset_id: assetId, kind: c.kind, triggered_at: r.timestamp,
          })
          if (!error) {
            const { data: a } = await supabase.from('assets').select('name').eq('id', assetId).single()
            healthNotes.push({ reason: `${a?.name ?? 'Vehicle'}: ${c.reason}`, severity: c.severity })
          }
        }
      }
      if (healthNotes.length) {
        const { data: co } = await supabase
          .from('companies').select('name, alert_phone, alert_email').eq('id', companyId).single()
        const { dispatchAlerts } = await import('@/lib/notify')
        await dispatchAlerts(co?.name ?? 'Your fleet', { phone: co?.alert_phone, email: co?.alert_email }, healthNotes, companyId)
      }
    }
  } catch (err) {
    console.error('vehicle health checks failed', err) // pre-022 DB or notify down — never break ingestion
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
        // Personal zones (owner_id set) are private reference only — never
        // drive company alerts. Migration 027 applies at build before this code
        // ships, so owner_id exists whenever this runs.
        supabase.from('geofences_json').select('*').eq('company_id', companyId).is('owner_id', null),
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
        // Alert-fatigue tiering: info events (routine enter/exit) are logged
        // but never dispatched — only warning/critical reach a phone.
        if (f.severity !== 'info') notifyBatch.push({ reason: f.reason, severity: f.severity })
      }

      // Text/webhook the owner for freshly-fired alerts (no-op unless Twilio /
      // webhook env vars are set). Never let delivery break ingestion.
      if (notifyBatch.length) {
        try {
          const { dispatchAlerts } = await import('@/lib/notify')
          const co = companyRow as { name?: string; alert_phone?: string; alert_email?: string }
          await dispatchAlerts(co.name ?? 'Your fleet', { phone: co.alert_phone, email: co.alert_email }, notifyBatch, companyId)
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
