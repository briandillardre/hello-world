import type { DeviceModel, LiveSignals } from '../devices'
import { MODELS } from '../devices'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface DeviceRow {
  id: string
  imei: string
  model: DeviceModel
  label: string | null
  iccid: string | null
  /** step key → ISO timestamp it was checked off. Absent = not done. */
  steps: Record<string, string | null>
  notes: string | null
  created_at: string
}

export interface DeviceWithLive extends DeviceRow {
  live: LiveSignals
}

/** Demo-mode fixtures: one of each interesting state, so the page is
 *  explorable with zero env vars like the rest of the app. */
const MOCK_DEVICES: DeviceWithLive[] = [
  {
    id: 'dev-1', imei: '863452084048569', model: 'FMM00A', label: 'Chevy 1500', iccid: '89883070000084226461',
    steps: { battery: '2026-08-26T01:00:00Z', sim_in: '2026-08-26T01:05:00Z', paired: '2026-08-26T01:05:00Z', sim_active: '2026-08-26T01:45:00Z', config_queued: '2026-08-26T02:45:00Z', installed: '2026-08-26T03:00:00Z' },
    notes: null, created_at: '2026-08-26T01:00:00Z',
    live: { registered: true, everReported: true, ageMin: 4, hasFix: true, beacons: 2, assetId: 'a1', assetName: 'Chevy 1500 - Brian' },
  },
  {
    id: 'dev-2', imei: '869267077050677', model: 'TAT141', label: 'Takeuchi TB235', iccid: '89883070000084226537',
    steps: { sim_in: '2026-08-28T20:00:00Z', paired: '2026-08-28T20:00:00Z', sim_active: '2026-08-28T20:46:00Z', config_queued: '2026-08-28T02:00:00Z' },
    notes: null, created_at: '2026-08-28T20:00:00Z',
    live: { registered: true, everReported: false, ageMin: null, hasFix: false, beacons: 0, assetId: 'a2', assetName: 'Takeuchi TB235' },
  },
  {
    id: 'dev-3', imei: '860813075166517', model: 'FMM650', label: 'Tool trailer', iccid: null,
    steps: { dummy_out: '2026-08-28T21:00:00Z', sim_in: '2026-08-28T21:10:00Z', antennas: '2026-08-28T21:20:00Z' },
    notes: 'Waiting on the 14th SIM from KORE.', created_at: '2026-08-28T21:00:00Z',
    live: { registered: false, everReported: false, ageMin: null, hasFix: false, beacons: 0, assetId: null, assetName: null },
  },
]

export async function getDevices(companyId: string): Promise<DeviceWithLive[]> {
  if (isMock) return MOCK_DEVICES

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()

  const { data: rows } = await supabase
    .from('device_onboarding')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })

  const devices = (rows ?? []) as DeviceRow[]
  if (!devices.length) return []

  // Join to live telemetry by tracker_id == imei. One query for every asset
  // that matches any listed IMEI, newest fix embedded — same shape (and same
  // ordering caveat) as getAssetsWithLocations: without the explicit order +
  // limit on the embed, Postgrest hands back an arbitrary historical row.
  const imeis = devices.map((d) => d.imei)
  const { data: assets } = await supabase
    .from('assets')
    .select(`
      id, name, tracker_id,
      location:asset_locations(lat, lng, timestamp, raw)
    `)
    .eq('company_id', companyId)
    .in('tracker_id', imeis)
    .order('timestamp', { ascending: false, referencedTable: 'asset_locations' })
    .limit(1, { referencedTable: 'asset_locations' })

  type Fix = { lat: number | null; lng: number | null; timestamp: string; raw: Record<string, unknown> | null }
  type Row = { id: string; name: string; tracker_id: string | null; location: Fix[] | Fix | null }

  const byImei = new Map<string, Row>()
  for (const a of (assets ?? []) as Row[]) if (a.tracker_id) byImei.set(a.tracker_id, a)

  return devices.map((d) => {
    const a = byImei.get(d.imei)
    const fix = a ? (Array.isArray(a.location) ? a.location[0] ?? null : a.location) : null
    const raw = (fix?.raw ?? {}) as Record<string, unknown>
    const beaconList = raw['ble.beacons']
    return {
      ...d,
      // Older rows may predate a step key; normalise to an object either way.
      steps: (d.steps ?? {}) as Record<string, string | null>,
      live: {
        registered: !!a,
        everReported: !!fix,
        ageMin: fix ? Math.round((Date.now() - new Date(fix.timestamp).getTime()) / 60_000) : null,
        hasFix: !!fix && fix.lat != null && fix.lng != null,
        beacons: Array.isArray(beaconList) ? beaconList.length : 0,
        assetId: a?.id ?? null,
        assetName: a?.name ?? null,
      },
    }
  })
}

export async function upsertDevice(
  companyId: string,
  input: { imei: string; model: DeviceModel; label?: string | null; iccid?: string | null; notes?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: true }

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { error } = await supabase
    .from('device_onboarding')
    .upsert({
      company_id: companyId,
      imei: input.imei,
      model: input.model,
      label: input.label ?? null,
      iccid: input.iccid ?? null,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,imei' })

  // Never surface a raw Postgres string — it leaks schema and reads as noise
  // to the person holding the device (sec-check, Aug 25).
  if (error) {
    console.error('device upsert failed:', error.message)
    return { ok: false, error: 'Could not save that device. Check the IMEI and try again.' }
  }
  return { ok: true }
}

/**
 * Check a manual step on or off. Read-modify-write on the JSONB map rather
 * than a jsonb_set RPC: the map is a handful of keys, and keeping it in TS
 * means the step list can change in lib/devices.ts without a migration.
 */
export async function setDeviceStep(
  companyId: string,
  imei: string,
  stepKey: string,
  done: boolean,
): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: true }

  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { data: row, error: readErr } = await supabase
    .from('device_onboarding')
    .select('steps')
    .eq('company_id', companyId)
    .eq('imei', imei)
    .maybeSingle()

  if (readErr || !row) {
    if (readErr) console.error('device step read failed:', readErr.message)
    return { ok: false, error: 'That device is no longer on your list.' }
  }

  const steps = { ...((row.steps ?? {}) as Record<string, string | null>) }
  if (done) steps[stepKey] = new Date().toISOString()
  else delete steps[stepKey]

  const { error } = await supabase
    .from('device_onboarding')
    .update({ steps, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('imei', imei)

  if (error) {
    console.error('device step write failed:', error.message)
    return { ok: false, error: 'Could not save that change.' }
  }
  return { ok: true }
}

export async function deleteDevice(companyId: string, imei: string): Promise<void> {
  if (isMock) return
  const { createClient } = await import('../supabase-server')
  const supabase = createClient()
  const { error } = await supabase
    .from('device_onboarding')
    .delete()
    .eq('company_id', companyId)
    .eq('imei', imei)
  if (error) console.error('device delete failed:', error.message)
}

/** Fleet-level rollup for the page header: how many devices are actually
 *  live, versus stuck somewhere in the pipeline. */
export function rollup(devices: DeviceWithLive[]) {
  let online = 0
  let waiting = 0
  let stuck = 0
  for (const d of devices) {
    if (d.live.everReported) online++
    else {
      const spec = MODELS[d.model] ?? MODELS.OTHER
      // "Stuck" means a step a human still owes it; "waiting" means everything
      // is done and it's only a matter of the device's own timer.
      const owed = spec.prep.some((p) => !d.steps[p.key])
      if (owed || !d.live.registered) stuck++
      else waiting++
    }
  }
  return { total: devices.length, online, waiting, stuck }
}
