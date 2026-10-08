import type { SupabaseClient } from '@supabase/supabase-js'
import { modelFromImei } from './devices'
import { readState, writeState } from './system-state'

/**
 * Every OBD (FMM00A) and wired (FMM650) unit HammerTrack knows about is
 * registered as a flespi DEVICE and gets the Green Driving settings once
 * (board #199, Brian Oct 8: "This should be automatic going forward for all
 * obd2 devices … as well as large trucks with FMM650"). The trackers already
 * stream through the flespi channel without being devices; flespi can only
 * queue commands to registered devices. Runs from the hourly health cron and
 * on demand from /api/admin/flespi (action "sync"). Needs FLESPI_COMMAND_TOKEN.
 */
const API = 'https://flespi.io/gw/devices'

/** docs/DRIVER-SCORES.md: light thresholds vs medium/heavy (GVWR > 10,000 lb). */
const GD_LIGHT = 'setparam 11000:1;11007:1;11004:2.7;11005:3.1;11006:3.4;11400:2;11401:5;11402:1500;11500:2;11600:1;11300:1'
const GD_HEAVY = 'setparam 11000:1;11007:1;11004:2.0;11005:2.0;11006:2.4;11400:2;11401:5;11402:1500;11500:2;11600:1;11300:1'

const HEAVY_NAME = /\b(f-?[3-7]50|[345]500|[45]50|dump|semi|day ?cab|tractor|box truck|peterbilt|kenworth|freightliner|mack|international|isuzu|hino)\b/i

export function isHeavy(name: string, metadata: Record<string, unknown> | null): boolean {
  const gvwr = Number((metadata as { gvwr?: unknown } | null)?.gvwr)
  if (Number.isFinite(gvwr) && gvwr > 0) return gvwr > 10_000
  return HEAVY_NAME.test(name)
}

type Flespi = { id: number; device_type_id?: number; configuration?: { ident?: string } }

async function api(path: string, init: RequestInit = {}) {
  const token = process.env.FLESPI_COMMAND_TOKEN
  if (!token) throw new Error('FLESPI_COMMAND_TOKEN not set')
  const r = await fetch(`${API}${path}`, { ...init, cache: 'no-store', headers: { Authorization: `FlespiToken ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const j = await r.json().catch(() => null) as { result?: Flespi[]; errors?: { reason?: string }[] } | null
  if (!r.ok) throw new Error(`flespi ${r.status}: ${j?.errors?.map((e) => e.reason).join('; ') ?? 'error'}`)
  return j?.result ?? []
}

/** flespi device type ids by model — read from a device already registered as
 *  that model, so nobody has to look an id up by hand. FMM650 falls back to the
 *  FMM00A's type only if FLESPI_TYPE_FMM650 is unset and no FMM650 exists yet. */
function typeIdFor(model: string, devices: Flespi[]): number | null {
  const env = Number(process.env[`FLESPI_TYPE_${model}`])
  if (Number.isFinite(env) && env > 0) return env
  for (const d of devices) {
    const m = modelFromImei(String(d.configuration?.ident ?? ''))
    if (m === model && d.device_type_id) return d.device_type_id
  }
  return null
}

export interface SyncResult { registered: string[]; queued: string[]; skipped: string[]; errors: string[] }

export async function syncFlespiDevices(svc: SupabaseClient): Promise<SyncResult> {
  const out: SyncResult = { registered: [], queued: [], skipped: [], errors: [] }
  if (!process.env.FLESPI_COMMAND_TOKEN) { out.errors.push('FLESPI_COMMAND_TOKEN not set'); return out }
  const { data: assets, error } = await svc.from('assets').select('name, tracker_id, metadata').eq('active', true).not('tracker_id', 'is', null)
  if (error) { out.errors.push(error.message); return out }
  const units = (assets ?? []).map((a) => ({ name: String(a.name ?? ''), imei: String(a.tracker_id ?? '').trim(), meta: a.metadata as Record<string, unknown> | null }))
    .filter((u) => /^\d{15}$/.test(u.imei))
    .map((u) => ({ ...u, model: modelFromImei(u.imei) }))
    .filter((u) => u.model === 'FMM00A' || u.model === 'FMM650')
  if (!units.length) return out

  let devices: Flespi[]
  try { devices = await api('/all?fields=id,device_type_id,configuration') } catch (e) { out.errors.push((e as Error).message); return out }
  const byIdent = new Map(devices.map((d) => [String(d.configuration?.ident ?? ''), d]))

  for (const u of units) {
    const tail = '…' + u.imei.slice(-5)
    try {
      if (!byIdent.has(u.imei)) {
        const type = typeIdFor(u.model!, devices) ?? (u.model === 'FMM650' ? null : null)
        if (!type) { out.skipped.push(`${tail} (${u.model}: no flespi type id yet — register one by hand or set FLESPI_TYPE_${u.model})`); continue }
        // Messages are kept by our own ingest; flespi needs only a day of them.
        const made = await api('', { method: 'POST', body: JSON.stringify([{ name: u.name.slice(0, 120), device_type_id: type, configuration: { ident: u.imei }, messages_ttl: 86_400 }]) })
        if (made[0]) { byIdent.set(u.imei, made[0]); out.registered.push(tail) }
      }
      const key = `flespi.green_driving.${u.imei}`
      if (await readState(svc, key)) continue
      const text = isHeavy(u.name, u.meta) ? GD_HEAVY : GD_LIGHT
      const q = await api(`/${encodeURIComponent(`configuration.ident=${u.imei}`)}/commands-queue`, { method: 'POST', body: JSON.stringify([{ name: 'custom', properties: { text }, ttl: 86_400 * 7 }]) })
      if (q.length) { await writeState(svc, key, { at: new Date().toISOString(), heavy: text === GD_HEAVY }); out.queued.push(tail) }
    } catch (e) { out.errors.push(`${tail}: ${(e as Error).message}`) }
  }
  return out
}
