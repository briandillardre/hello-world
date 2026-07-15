/**
 * Persist normalized ISO 15143-3 readings into HammerTrack. Server-only.
 * Shared by the push endpoint (/api/ingest/aemp) and the pull cron
 * (/api/cron/oem-sync) so mapping + write logic lives in exactly one place.
 *
 * OEM machine → HammerTrack asset matching, in priority order:
 *   1. tracker_id = `aemp:<SerialNumber>`  (the registration convention)
 *   2. tracker_id = `aemp:<PIN>` / `aemp:<EquipmentID>`
 *   3. assets.serial matches SerialNumber or PIN (so a machine registered with
 *      just its serial auto-links without a synthetic tracker_id)
 * Matching is case/format-insensitive. Unmatched machines are returned so the
 * caller can tell the owner "this machine is reporting but isn't registered".
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AempReading } from './aemp'

export interface ApplyResult {
  matched: number
  located: number      // readings that carried a usable GPS fix
  metaUpdated: number
  faults: number
  unmatched: { equipmentId: string | null; serial: string | null; oem: string | null }[]
}

const strip = (s: string) => s.replace(/[^0-9a-z]/gi, '').toLowerCase()

interface AssetRow {
  id: string
  tracker_id: string | null
  serial: string | null
  metadata: Record<string, unknown> | null
  name: string | null
}

/** Build the set of tracker_id/serial forms an asset can be matched by. */
function assetKeys(a: AssetRow): Set<string> {
  const keys = new Set<string>()
  if (a.tracker_id) {
    const t = a.tracker_id.toLowerCase()
    // Registration convention: `aemp:<serial>` — index the bare id after the prefix.
    const m = t.match(/^aemp:(.+)$/)
    if (m) keys.add(strip(m[1]))
  }
  if (a.serial) keys.add(strip(a.serial))
  return keys
}

export async function applyAempReadings(
  supabase: SupabaseClient,
  companyId: string,
  provider: string,
  readings: AempReading[]
): Promise<ApplyResult> {
  const result: ApplyResult = { matched: 0, located: 0, metaUpdated: 0, faults: 0, unmatched: [] }
  if (!readings.length) return result

  const { data: assets } = await supabase
    .from('assets')
    .select('id, tracker_id, serial, metadata, name')
    .eq('company_id', companyId)
  const rows = (assets ?? []) as AssetRow[]

  // key form -> asset, for O(1) matching against each reading's serial/pin/id.
  const index = new Map<string, AssetRow>()
  for (const a of rows) {
    for (const k of Array.from(assetKeys(a))) if (k.length >= 4 && !index.has(k)) index.set(k, a)
  }

  const faultNotes: { reason: string; severity: 'critical' | 'warning' | 'info' }[] = []

  for (const r of readings) {
    const candidates = [r.serial, r.pin, r.equipmentId].filter(Boolean).map((s) => strip(String(s)))
    let asset: AssetRow | undefined
    for (const c of candidates) {
      if (c.length >= 4 && index.has(c)) { asset = index.get(c); break }
    }
    if (!asset) {
      result.unmatched.push({ equipmentId: r.equipmentId, serial: r.serial, oem: r.oem })
      continue
    }
    result.matched++

    // Position → asset_locations so the machine shows on the live map/timeline,
    // exactly like a flespi/OBD fix. Skip when the snapshot carried no GPS.
    if (typeof r.lat === 'number' && typeof r.lng === 'number' &&
        r.lat >= -90 && r.lat <= 90 && r.lng >= -180 && r.lng <= 180) {
      await supabase.from('asset_locations').insert({
        asset_id: asset.id,
        company_id: companyId,
        lat: r.lat,
        lng: r.lng,
        speed: null,
        heading: null,
        altitude: r.altitude != null ? Math.round(r.altitude) : null,
        battery: null,
        accuracy: null,
        timestamp: r.timestamp,
        raw: { source: `aemp:${provider}`, ...r.params },
      })
      result.located++
    }

    // Engine hours / odometer / fuel / faults → asset.metadata. Merge, never
    // clobber the blob. This is what feeds maintenance meters and utilization.
    const prevMeta = (asset.metadata ?? {}) as Record<string, unknown>
    const meta: Record<string, unknown> = { ...prevMeta, oem: r.oem ?? prevMeta.oem, oem_provider: provider, last_oem_sync: r.timestamp }
    if (r.engineHours != null) meta.engine_hours = r.engineHours
    if (r.idleHours != null) meta.idle_hours = r.idleHours
    if (r.odometerKm != null) { meta.odometer_km = r.odometerKm; meta.odometer = Math.round(r.odometerKm * 0.621371) }
    if (r.fuelPct != null) meta.fuel_pct = r.fuelPct
    if (r.fuelUsedL != null) meta.fuel_used_l = r.fuelUsedL
    if (r.defPct != null) meta.def_pct = r.defPct
    if (r.engineRunning != null) meta.engine_on = r.engineRunning
    if (r.faults.length) meta.oem_faults = r.faults
    await supabase.from('assets').update({ metadata: meta }).eq('id', asset.id)
    result.metaUpdated++
    if (r.faults.length) result.faults += r.faults.length

    // Active fault codes are premium value — surface them once per 24h per
    // (asset, fault) via alert_events (kind='oem_fault'), best-effort.
    if (r.faults.length) {
      try {
        const sinceIso = new Date(Date.now() - 24 * 3_600_000).toISOString()
        const { data: recent } = await supabase
          .from('alert_events')
          .select('id')
          .eq('asset_id', asset.id)
          .eq('kind', 'oem_fault')
          .gte('triggered_at', sinceIso)
          .limit(1)
        if (!recent?.length) {
          const { error } = await supabase.from('alert_events').insert({
            company_id: companyId, asset_id: asset.id, kind: 'oem_fault', triggered_at: r.timestamp,
          })
          if (!error) {
            const top = r.faults[0]
            const label = top.description || `SPN ${top.spn ?? '?'} / FMI ${top.fmi ?? '?'}`
            faultNotes.push({
              reason: `${asset.name ?? 'Machine'}: ${r.faults.length} active fault${r.faults.length > 1 ? 's' : ''} — ${label}`,
              severity: 'warning',
            })
          }
        }
      } catch { /* pre-022 DB (no kind column) — never break ingestion */ }
    }
  }

  if (faultNotes.length) {
    try {
      const { data: co } = await supabase
        .from('companies').select('name, alert_phone, alert_email').eq('id', companyId).single()
      const { dispatchAlerts } = await import('./notify')
      await dispatchAlerts(co?.name ?? 'Your fleet', { phone: co?.alert_phone, email: co?.alert_email }, faultNotes)
    } catch { /* notify down — faults are already logged */ }
  }

  return result
}
