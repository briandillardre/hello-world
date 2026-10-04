import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { normalizeMessage, type FlespiMessage, type NormalizedReading } from '@/lib/flespi'
import { evaluateAlerts, pointInPolygon, type PriorFix } from '@/lib/alerts-engine'
import { vehiclePower } from '@/lib/vehicle-power'
import type { Asset, AssetLocation, AlertRule, Geofence } from '@/lib/types'
import { recordBeaconSightings } from '@/lib/ble-sightings'
import { checkTruckPower } from '@/lib/power-loss-check'
import { recordTelemetry } from '@/lib/telemetry-ingest'
import { POWERED_MIN_V, externalVolts } from '@/lib/power-loss'
import { safeTz } from '@/lib/dates'
import {
  CONFIRM_WINDOW_MS, JUMP_WINDOW_MS, chatterState, chatterStep, fixIsValid, isTagChatter, jumpBasis, jumpReason,
  jumpVerdict, newestFix, tagIdsOf, type ChatterFix, type ChatterState, type GuardFix,
} from '@/lib/ingest-guard'

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

// Real flespi batches are small, but the showroom simulator's catch-up
// batches (60 msgs × sequential per-message DB work + beacon round-trips)
// need more than the platform default (ship-check P2, Aug 24).
export const maxDuration = 60

/** One asset_locations row as the ingest writes it. */
interface LocRow {
  asset_id: string
  company_id: string
  lat: number
  lng: number
  speed: number | null
  heading: number | null
  altitude: number | null
  battery: number | null
  accuracy: null
  timestamp: string
  raw: Record<string, unknown>
  ignition: boolean | null
}

/** A fix the guards may hold back, carrying the row to write if it is kept. */
type HeldFix = ChatterFix & { row: LocRow }

function toFix(row: { timestamp: string; lat: number; lng: number; speed: number | null; raw: Record<string, unknown> | null }, thin = true): ChatterFix {
  return {
    ms: Date.parse(row.timestamp), lat: row.lat, lng: row.lng, speed: row.speed, valid: fixIsValid(row.raw),
    chatter: thin && isTagChatter(row.raw, row.speed), tags: tagIdsOf(row.raw),
  }
}

function heldFix(row: LocRow, thin = true): HeldFix {
  return { ...toFix(row, thin), row }
}

/** A row this route wrote into asset_fix_tail / asset_location_rejects, read
 *  back — only ever the asset's own, only with a usable position, and filed
 *  under the company that owns the asset NOW: a machine moved to another
 *  company between batches must not write its held record into the old
 *  company's books (sec-check, Sep 28). */
function asLocRow(v: unknown, assetId: string, companyId: string): LocRow | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<LocRow>
  if (o.asset_id !== assetId) return null
  if (typeof o.lat !== 'number' || typeof o.lng !== 'number' || typeof o.timestamp !== 'string' || !Number.isFinite(Date.parse(o.timestamp))) return null
  return {
    asset_id: o.asset_id, company_id: companyId, lat: o.lat, lng: o.lng,
    speed: typeof o.speed === 'number' ? o.speed : null,
    heading: typeof o.heading === 'number' ? o.heading : null,
    altitude: typeof o.altitude === 'number' ? o.altitude : null,
    battery: typeof o.battery === 'number' ? o.battery : null,
    accuracy: null,
    timestamp: o.timestamp,
    raw: o.raw && typeof o.raw === 'object' ? o.raw : {},
    ignition: typeof o.ignition === 'boolean' ? o.ignition : null,
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
  let buffered = 0
  // company_id -> latest reading per updated asset, for alert evaluation below
  const updated = new Map<string, Map<string, NormalizedReading>>()
  // asset_id -> the fix on record BEFORE this batch, for edge-triggered zone
  // alerts (left/entered = a transition, not a state — otherwise a truck
  // driving around town re-fires "left site" every dedupe window all day).
  const prevFix = new Map<string, { lat: number; lng: number; speed: number | null; timestamp: string }>()
  // The reading before each asset's latest one in this batch — speeding needs two in a row.
  const priorInBatch = new Map<string, NormalizedReading>()
  // Names for the alert lines, and which assets reported their power pin in
  // this batch — the plug-came-out detector (lib/power-loss) runs for those.
  const assetNames = new Map<string, string>()
  const hadPowerPin = new Set<string>()
  // …and which of those read NO truck power in this batch, plus how many
  // rows each asset gained — the detector reads only what those say it must.
  const lowInBatch = new Set<string>()
  const insertedRows = new Map<string, number>()
  // Every stored fix's parameter bag, per asset — folded once per batch into
  // asset_telemetry_latest (115), the "what does this truck report" row.
  const telemetryRows = new Map<string, { companyId: string; rows: { timestamp: string; params: Record<string, unknown> }[] }>()
  // Per-asset stream guards (lib/ingest-guard, 124): GPS spikes and parked
  // tag chatter.
  const guards = new Map<string, {
    companyId: string
    thin: boolean
    s: ChatterState<HeldFix>
    loadedTail: HeldFix | null
    lastReject: { fix: HeldFix; id: number | null } | null
    rejectLoaded: boolean
    /** The newest fix with a real GPS position (jumpBasis) — the newest
     *  stored row may be a no-fix record repeating an old place. */
    lastValid: GuardFix | null
    validLoaded: boolean
  }>()
  let thinned = 0
  let rejected = 0

  /** Write one position row; false when it bounced (logged). */
  const storeRow = async (row: LocRow): Promise<boolean> => {
    let { error: locErr } = await supabase.from('asset_locations').insert(row)
    // Retry without the column ONLY on a pre-034 schema (undefined column /
    // stale schema cache). Any other failure is real — retrying it masked
    // RLS/data errors and `persisted` over-counted (code review, Jul 21).
    if (locErr && (locErr.code === '42703' || locErr.code === 'PGRST204')) {
      const pre034: Partial<LocRow> = { ...row }
      delete pre034.ignition
      ;({ error: locErr } = await supabase.from('asset_locations').insert(pre034))
    }
    if (locErr) {
      // Beacon association still runs — tools shouldn't lose their
      // last-seen because one location row bounced.
      console.error(`flespi: asset_locations insert failed for ${row.asset_id}: ${locErr.code} ${locErr.message}`)
      return false
    }
    persisted++
    insertedRows.set(row.asset_id, (insertedRows.get(row.asset_id) ?? 0) + 1)
    const tr: { companyId: string; rows: { timestamp: string; params: Record<string, unknown> }[] } =
      telemetryRows.get(row.asset_id) ?? { companyId: row.company_id, rows: [] }
    tr.rows.push({ timestamp: row.timestamp, params: row.raw })
    telemetryRows.set(row.asset_id, tr)
    return true
  }

  for (const r of normalized) {
    // Plausibility gate (sec-check, Sep 1): a fix dated in the future would sit
    // as the asset's 'latest' position forever (every read orders by
    // timestamp desc) and one older than a month is a replay or a device with
    // a broken clock — trackers buffering offline surface days late, not
    // months. Dropped fixes are logged by ident so a real clock fault shows.
    const tsMs = Date.parse(r.timestamp)
    if (!Number.isFinite(tsMs) || tsMs > Date.now() + 5 * 60_000 || tsMs < Date.now() - 30 * 86_400_000) {
      console.warn(`flespi ingest: implausible timestamp ${r.timestamp} from ${r.tracker_id} — dropped`)
      continue
    }
    // active-only: a deactivated asset releases its tracker (the resale
    // flow), and 082's one-active-owner index makes this lookup unique —
    // a second company's registration can no longer silently kill the
    // real device's readings via a two-row .single() error (sec-check).
    const { data: asset } = await supabase
      .from('assets')
      .select('id, company_id, name')
      .eq('tracker_id', r.tracker_id)
      .eq('active', true)
      .single()
    if (!asset) {
      // Nobody is wearing this box. Buffer the fix (092) for ONE company so
      // putting the tracker on an asset later can pull the history in.
      // Which company: the one whose asset most recently carried this IMEI
      // (drawer, soft-deleted, deactivated-to-resell — all inactive rows);
      // failing that, the registry, but only when exactly one company lists
      // it. Never fan out: a tenant that lists someone else's IMEI must not
      // receive their fixes (sec-check P1, Sep 4). 093 also makes a 15-digit
      // IMEI unique across registries. Unregistered IMEIs are dropped.
      let bufferFor: string | null = null
      const { data: prior } = await supabase
        .from('assets').select('company_id')
        .eq('tracker_id', r.tracker_id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (prior?.company_id) bufferFor = prior.company_id
      else {
        const { data: owners } = await supabase
          .from('device_onboarding').select('company_id').eq('imei', r.tracker_id).limit(2)
        if (owners?.length === 1) bufferFor = owners[0].company_id
        else if ((owners?.length ?? 0) > 1) console.warn(`flespi: ${r.tracker_id} listed by ${owners!.length} registries and no asset — dropped`)
      }
      if (bufferFor) {
        const { error: bufErr } = await supabase.from('unassigned_locations').insert({
          company_id: bufferFor, imei: r.tracker_id,
          lat: r.lat, lng: r.lng, speed: r.speed, heading: r.heading, altitude: r.altitude, battery: r.battery,
          timestamp: r.timestamp, raw: { source: 'flespi', ...r.params },
          ignition: vehiclePower({ source: 'flespi', ...r.params }).engineOn,
        })
        if (bufErr && bufErr.code !== '42P01') console.error(`flespi: buffer insert failed for ${r.tracker_id}: ${bufErr.message}`)
        else if (!bufErr) buffered++
      }
      continue
    }

    assetNames.set(asset.id, (asset.name as string | null) ?? 'Tracker')

    // The asset's stream so far — its newest stored row (also the "before
    // this batch" fix the zone-edge alerts compare against) and the parked
    // record held back last batch (124). Once per asset per batch.
    let g = guards.get(asset.id)
    if (!g) {
      const [{ data: prev }, tailQ] = await Promise.all([
        supabase.from('asset_locations').select('lat, lng, speed, timestamp, raw')
          .eq('asset_id', asset.id).order('timestamp', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('asset_fix_tail').select('fix, run_tags').eq('asset_id', asset.id).maybeSingle(),
      ])
      if (prev) prevFix.set(asset.id, { lat: prev.lat, lng: prev.lng, speed: prev.speed ?? null, timestamp: prev.timestamp })
      const tailRow = !tailQ.error ? asLocRow(tailQ.data?.fix, asset.id, asset.company_id) : null
      const loadedTail = tailRow ? heldFix(tailRow) : null
      const prevFixed = prev ? toFix(prev) : null
      // Newest real position we already hold: the held record if it is one
      // and newer, else the newest row. Neither = looked up if ever needed.
      const lastValid = [loadedTail, prevFixed]
        .filter((f): f is ChatterFix => !!f && f.valid !== false)
        .sort((a, b) => b.ms - a.ms)[0] ?? null
      g = {
        companyId: asset.company_id,
        // No tail table (pre-124) = no thinning: without somewhere to hold a
        // run's last record between batches the time math would drift.
        thin: !tailQ.error,
        s: chatterState<HeldFix>(prevFixed, loadedTail, (tailQ.data?.run_tags as string[] | null) ?? []),
        loadedTail,
        lastReject: null,
        rejectLoaded: false,
        lastValid,
        // Either one found is the newest real position there is (the row is
        // the newest stored, the held record newer still); none = look back.
        validLoaded: !!lastValid,
      }
      guards.set(asset.id, g)
    }

    const locRow: LocRow = {
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
      // Engine state as a REAL column (034) so the idle math can select it
      // cheaply — idle must mean engine ON, not merely device-awake.
      ignition: null,
    }
    locRow.ignition = vehiclePower(locRow.raw).engineOn
    let fix = heldFix(locRow, g.thin)
    // The reading as the rest of the loop uses it (custody, zone alerts) —
    // re-placed below when it has no GPS fix of its own.
    let rd: NormalizedReading = r

    // ── GPS spike guard (lib/ingest-guard) ──────────────────────────────────
    // A fix hundreds of miles out and back in minutes is not a place the
    // machine went. Logged in asset_location_rejects, never drawn; a second
    // fix that agrees with it proves the move and both go in.
    const before = newestFix(g.s)
    let basis: GuardFix | null = before
    // A reject counts only until a real fix is accepted after it: that fix
    // already answered it (no-fix records answer nothing — they repeat it).
    const openReject = (): GuardFix | null =>
      g.lastReject && (!g.lastValid || g.lastReject.fix.ms > g.lastValid.ms) ? g.lastReject.fix : null
    let verdict = jumpVerdict(basis, fix, openReject())
    if (verdict === 'reject' && before?.valid === false) {
      // The newest record had no GPS fix: it repeats an old place under a
      // fresh time. Measure from the newest REAL fix instead (jumpBasis) — a
      // haul made with the GPS jammed or boxed in then reads as road speed.
      if (!g.validLoaded) {
        g.validLoaded = true
        const { data: back } = await supabase.from('asset_locations')
          .select('lat, lng, speed, timestamp, sats:raw->"position.satellites", valid:raw->"position.valid"')
          .eq('asset_id', asset.id)
          .gte('timestamp', new Date(fix.ms - JUMP_WINDOW_MS).toISOString())
          .order('timestamp', { ascending: false }).limit(2000)
        const rows = (back ?? []) as { lat: number; lng: number; speed: number | null; timestamp: string; sats: unknown; valid: unknown }[]
        const hit = rows.find((b) => fixIsValid({ 'position.valid': b.valid, 'position.satellites': b.sats }))
        const found = hit ? { ms: Date.parse(hit.timestamp), lat: hit.lat, lng: hit.lng, speed: hit.speed } : null
        if (found && Number.isFinite(found.ms) && (!g.lastValid || found.ms > g.lastValid.ms)) g.lastValid = found
      }
      const b = jumpBasis(before, g.lastValid, fix)
      if (b !== before) {
        basis = b
        verdict = jumpVerdict(basis, fix, openReject())
      }
    }
    if (verdict === 'reject' && !g.lastReject && !g.rejectLoaded) {
      g.rejectLoaded = true
      const { data: rj } = await supabase.from('asset_location_rejects')
        .select('id, fix').eq('asset_id', asset.id).is('restored_at', null)
        .gte('timestamp', new Date(fix.ms - CONFIRM_WINDOW_MS).toISOString())
        .order('timestamp', { ascending: false }).limit(1).maybeSingle()
      const rjRow = asLocRow(rj?.fix, asset.id, asset.company_id)
      if (rj && rjRow) {
        g.lastReject = { fix: heldFix(rjRow), id: rj.id as number }
        verdict = jumpVerdict(basis, fix, openReject())
      }
    }
    if (verdict === 'reject' && fix.valid === false && before) {
      // No GPS fix of its own: the unit repeats the last place it knew — the
      // one just turned away. That is no evidence of a move (it can never
      // confirm one) and must not be drawn; its other data (engine, power
      // pin, tags heard) still counts, filed at the newest place on record.
      locRow.lat = before.lat
      locRow.lng = before.lng
      fix = heldFix(locRow, g.thin)
      rd = { ...r, lat: before.lat, lng: before.lng }
      verdict = 'ok'
    }
    if (verdict === 'reject') {
      const reason = jumpReason(basis!, fix)
      console.warn(`flespi: ${r.tracker_id} fix at ${r.timestamp} (${r.lat}, ${r.lng}) rejected — ${reason}`)
      const { data: logged } = await supabase.from('asset_location_rejects').insert({
        asset_id: asset.id, company_id: asset.company_id, timestamp: r.timestamp,
        lat: r.lat, lng: r.lng, reason, fix: locRow,
      }).select('id').maybeSingle()
      g.lastReject = { fix, id: (logged?.id as number | undefined) ?? null }
      rejected++
      continue
    }
    if (verdict === 'confirmed' && g.lastReject) {
      // The fix we turned away was real — it goes in first, in its place.
      const confirmed = g.lastReject
      g.lastReject = null
      // No-fix records since it repeated that place and were filed at the
      // last accepted one (below); the move was real, so they go where the
      // unit said it was — else the day draws (and counts) a trip back.
      const refile = (f: ChatterFix & { row?: LocRow }) => {
        if (f.valid !== false || f.ms <= confirmed.fix.ms) return
        f.lat = confirmed.fix.lat
        f.lng = confirmed.fix.lng
        if (f.row) { f.row.lat = f.lat; f.row.lng = f.lng }
      }
      if (g.s.last) refile(g.s.last)
      if (g.s.tail) refile(g.s.tail)
      const { data: filed } = await supabase.from('asset_locations')
        .select('id, sats:raw->"position.satellites", valid:raw->"position.valid"')
        .eq('asset_id', asset.id).gt('timestamp', confirmed.fix.row.timestamp).lt('timestamp', r.timestamp).limit(1000)
      const refiled = ((filed ?? []) as { id: string; sats: unknown; valid: unknown }[])
        .filter((x) => !fixIsValid({ 'position.valid': x.valid, 'position.satellites': x.sats })).map((x) => x.id)
      for (let i = 0; i < refiled.length; i += 100) {
        const { error } = await supabase.from('asset_locations')
          .update({ lat: confirmed.fix.lat, lng: confirmed.fix.lng }).in('id', refiled.slice(i, i + 100))
        if (error) console.error(`flespi: re-filing no-fix records for ${asset.id} failed: ${error.code} ${error.message}`)
      }
      const step = chatterStep(g.s, confirmed.fix)
      if (step.flush) await storeRow(step.flush.row)
      if (step.store) await storeRow(confirmed.fix.row)
      if (confirmed.id != null) {
        await supabase.from('asset_location_rejects').update({ restored_at: new Date().toISOString() }).eq('id', confirmed.id)
      }
    }
    if (fix.valid !== false && (!g.lastValid || fix.ms >= g.lastValid.ms)) {
      // Newer than any stored row — nothing left to look back for.
      g.lastValid = fix
      g.validLoaded = true
    }

    const pinVolts = externalVolts(r.params)
    if (pinVolts != null) {
      hadPowerPin.add(asset.id)
      if (pinVolts < POWERED_MIN_V) lowInBatch.add(asset.id)
    }

    // ── Parked tag chatter (lib/ingest-guard) ───────────────────────────────
    // A repeat of "parked here, hearing these tags" is not stored as a
    // position; tool custody below still hears every one of them.
    const step = chatterStep(g.s, fix)
    if (step.flush) await storeRow(step.flush.row)
    if (!step.store) {
      thinned++
    } else if (await storeRow(locRow)) {
      if (!updated.has(asset.company_id)) updated.set(asset.company_id, new Map())
      const was = updated.get(asset.company_id)!.get(asset.id)
      if (was) priorInBatch.set(asset.id, was)
      updated.get(asset.company_id)!.set(asset.id, rd)
    }

    // BLE tags this box heard → tool custody. The matcher, the strongest-
    // signal arbitration and the pairing history live in lib/ble-sightings
    // (shared with the phone gateway, /api/ingest/ble-phone).
    if (rd.beacons.length) {
      try { await recordBeaconSightings(supabase, asset, { lat: rd.lat, lng: rd.lng, timestamp: rd.timestamp }, rd.beacons, { reportedAs: 'hex' }) } catch { /* custody is additive */ }
    }
  }

  // A parked run still going at the end of the batch: hold its newest
  // record for the next batch (124), so the record that ends the run can
  // put it in first.
  for (const [assetId, g] of Array.from(guards.entries())) {
    const t = g.s.tail as HeldFix | null
    if (!g.thin || !t || t === g.loadedTail) continue
    const { error } = await supabase.from('asset_fix_tail').upsert({
      asset_id: assetId, company_id: g.companyId, ts: t.row.timestamp, fix: t.row,
      run_tags: Array.from(g.s.runTags), updated_at: new Date().toISOString(),
    })
    if (error) console.error(`flespi: holding the parked record for ${assetId} failed: ${error.code} ${error.message}`)
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
          // A 24 V machine reads double — the same ladder ×2 the dials use
          // (lib/telemetry-catalog voltScale), or a sagging 22 V pair never alerts.
          const scale = volts > 18 ? 2 : 1
          if (volts > 5 && volts < 11.8 * scale) {
            checks.push({ kind: 'battery_low', reason: `${scale === 2 ? '24V' : '12V'} battery weak — ${volts.toFixed(1)} V`, severity: volts < 11.4 * scale ? 'critical' : 'warning' })
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
      // Truck power: the plug-came-out detector, for every unit in this batch
      // that reported its power pin. One alert per episode, debounced past a
      // flicker; power returning clears it by itself (lib/power-loss-check).
      const powerAssets = Array.from(byAsset.keys()).filter((id) => hadPowerPin.has(id)).slice(0, 25)
      // The company row is read at most once, and only when there is a line
      // to send — a steady, powered truck costs this batch nothing extra.
      type CompanyRow = { name?: string | null; alert_phone?: string | null; alert_email?: string | null; digest_prefs?: unknown }
      let co: CompanyRow | null = null
      const company = async (): Promise<CompanyRow> => {
        if (!co) {
          const { data } = await supabase
            .from('companies').select('name, alert_phone, alert_email, digest_prefs').eq('id', companyId).single()
          co = (data as CompanyRow | null) ?? {}
        }
        return co
      }
      const getTz = async () => safeTz(((await company()).digest_prefs as { tz?: string } | null | undefined)?.tz)
      for (const assetId of powerAssets) {
        const note = await checkTruckPower(
          supabase,
          { id: assetId, company_id: companyId, name: assetNames.get(assetId) ?? 'Tracker' },
          getTz,
          { lowInBatch: lowInBatch.has(assetId), inserted: insertedRows.get(assetId) ?? 0 },
        )
        if (note) healthNotes.push(note)
      }
      if (healthNotes.length) {
        const c = await company()
        const { dispatchAlerts } = await import('@/lib/notify')
        await dispatchAlerts(c.name ?? 'Your fleet', { phone: c.alert_phone, email: c.alert_email }, healthNotes, companyId)
      }
    }
  } catch (err) {
    console.error('vehicle health checks failed', err) // pre-022 DB or notify down — never break ingestion
  }

  // ── Truck readings (115): newest value of every parameter, per asset ──────
  // One RPC per asset per batch; additive — never breaks ingestion.
  for (const [assetId, tr] of Array.from(telemetryRows.entries())) {
    await recordTelemetry(supabase, assetId, tr.companyId, tr.rows)
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

      const previous: Record<string, PriorFix | undefined> = {}
      for (const a of targets) {
        const b = priorInBatch.get(a.id)
        previous[a.id] = b ? { lat: b.lat, lng: b.lng, speed: b.speed, timestamp: b.timestamp } : prevFix.get(a.id)
      }
      const fired = evaluateAlerts({
        assets: targets,
        locations,
        previous,
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

  return NextResponse.json({ ok: true, persisted, buffered, thinned, rejected, alerts: alertsFired })
}
