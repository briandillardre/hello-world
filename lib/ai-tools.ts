/**
 * AI assistant tools — the model's hands into real fleet data.
 *
 * Every executor queries through the caller's Supabase session, so RLS scopes
 * everything to their company; a hallucinated asset id returns zero rows, not
 * someone else's truck. Numbers come from the same shared math the UI uses
 * (lib/asset-stats, lib/visits) so the assistant never disagrees with the
 * screens.
 */
import type { AssetWithLocation, Geofence, AlertEvent } from './types'
import { MCP_TOOLS, runMcpTool } from './mcp-tools'
import { pointInPolygon } from './alerts-engine'
import { computeRangeStats, estMpgForSpecs, type StatPoint } from './asset-stats'
import { segmentVisits, type VisitPoint } from './visits'
import { rangeWindow, fmtDateTime, type TimeRangeKey } from './dates'
import { segmentStops } from './poi'
import { classifyStops } from './poi-server'

export interface AiToolCtx {
  companyId: string
  tz: string
  assets: AssetWithLocation[]
  geofences: Geofence[]
  alerts: AlertEvent[]
  /** Session door's role gate: the signed-in user may see dollar figures.
   *  (The MCP door has no per-user roles — a company key is admin-grade.) */
  canViewCosts: boolean
}

// ── Shared MCP registry (task #28: one brain, three doors) ──────────────────
// The Agent Interface (lib/mcp-tools.ts) is the canonical tool registry.
// The in-app assistant serves the subset it doesn't already cover natively
// (fleet_snapshot ⊇ list_assets, recent_alerts ⊇ list_alerts), so an answer
// in the app and an answer through a customer's own AI come from the same
// executors and the same house math.
const SHARED_MCP_TOOLS: readonly string[] = ['get_zone_costs', 'maintenance_status', 'find_tool', 'whats_worth_a_look']
/** Tools that return dollars — hidden AND refused for non-cost roles.
 *  whats_worth_a_look is here because most insight rows carry money. */
const COST_GATED_TOOLS = new Set(['get_zone_costs', 'whats_worth_a_look'])

/** Anthropic-format defs for the shared MCP tools this user may call. */
export function sharedMcpToolDefs(canViewCosts: boolean) {
  return MCP_TOOLS
    .filter((t) => SHARED_MCP_TOOLS.includes(t.name))
    .filter((t) => canViewCosts || !COST_GATED_TOOLS.has(t.name))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
}

// Anthropic Messages API custom-tool definitions (raw JSON schema).
export const AI_TOOLS = [
  {
    name: 'fleet_snapshot',
    description:
      'Live snapshot of every asset: type, current site (zone) or off-site, speed, battery, last-seen time. Use for "where is…", "who/what is at…", "what is moving" questions about RIGHT NOW.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'asset_activity',
    description:
      'Activity stats for ONE asset over a named range: miles driven, top speed, time moving / idling / parked, engine starts, estimated fuel. Use for "how far did X drive", "was X used last week", utilization questions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        asset_name: { type: 'string', description: 'Asset name, may be partial ("chevy", "atlas")' },
        range: { type: 'string', enum: ['today', 'yesterday', '7d', '30d', 'ytd', 'all'], description: 'Time range' },
      },
      required: ['asset_name', 'range'],
    },
  },
  {
    name: 'site_visits',
    description:
      'Visit log for ONE zone/site over the last N days: which assets entered, arrival and departure times, minutes on site. Use for "how long was X at Y", "who came to the site yesterday", attendance/accountability questions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        zone_name: { type: 'string', description: 'Zone/site name, may be partial' },
        days: { type: 'number', description: 'How many days back to look (1-14, default 7)' },
      },
      required: ['zone_name'],
    },
  },
  {
    name: 'asset_stops',
    description:
      'Every stop (5+ min) one asset made in a range, WITH what kind of place each was: job site, supplier, fuel station, restaurant/food, government office (DMV etc.), dealer, repair shop, store, or residence — plus arrival time and duration. Use for "where did X eat lunch", "did X stop at the supplier", "what did X do between sites", and any off-site accountability question.',
    input_schema: {
      type: 'object' as const,
      properties: {
        asset_name: { type: 'string', description: 'Asset name, may be partial' },
        range: { type: 'string', enum: ['today', 'yesterday', '7d'], description: 'Time range (default today)' },
      },
      required: ['asset_name'],
    },
  },
  {
    name: 'asset_telemetry',
    description:
      'EVERY live telemetry parameter from ONE asset\'s latest report: fuel tank level %, engine RPM, ignition, battery/12V voltages, odometer, coolant temp, trouble codes — the full OBD parameter bag. Use for "how much fuel does X have", odometer, engine-health, and any question about a specific reading.',
    input_schema: {
      type: 'object' as const,
      properties: { asset_name: { type: 'string', description: 'Asset name, may be partial' } },
      required: ['asset_name'],
    },
  },
  {
    name: 'eta_to_zone',
    description:
      'Rough ETA for ONE asset to ONE zone/site: straight-line distance with a road factor, the speed it is doing right now (or a stated assumption if parked), estimated minutes, and arrival clock time. NOT turn-by-turn routing — always present it as a rough ETA. Use for "how long until X gets to Y", "when will X arrive", "how far is X from Y".',
    input_schema: {
      type: 'object' as const,
      properties: {
        asset_name: { type: 'string', description: 'Asset name, may be partial' },
        zone_name: { type: 'string', description: 'Zone/site name, may be partial' },
      },
      required: ['asset_name', 'zone_name'],
    },
  },
  {
    name: 'daily_logs',
    description:
      'Submitted crew daily logs over the last N days: who wrote it, which site they were clocked into, the day\'s writeup, safety issues, fuel answers, every custom form answer, photo count, and where the phone was. Use for "what happened on site", "did anyone report safety issues", "what did the crew log yesterday", "who worked at X and what did they say".',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'How many days back (1-14, default 3)' },
        zone_name: { type: 'string', description: 'Optional: only logs from crews clocked into this zone/site (partial name ok)' },
      },
      required: [],
    },
  },
  {
    name: 'recent_alerts',
    description:
      'Recent alert events (theft, after-hours movement, left-site, low battery) with asset, trigger, time, and whether acknowledged. Use for any alerts/theft/security question.',
    input_schema: {
      type: 'object' as const,
      properties: { limit: { type: 'number', description: 'Max events (default 10)' } },
      required: [],
    },
  },
]

/** Longest-name fuzzy match so "the truck" can't grab every vehicle but
 *  "chevy" finds "Chevy 1500 - Brian". */
function matchByName<T extends { name: string }>(q: string, list: T[]): T | null {
  const s = q.trim().toLowerCase()
  if (!s) return null
  let best: T | null = null
  for (const item of list) {
    const n = item.name.toLowerCase()
    if ((n.includes(s) || s.includes(n)) && (!best || item.name.length > best.name.length)) best = item
  }
  return best
}

/** In-progress dwell: is this asset sitting still RIGHT NOW, and since when?
 *  The stops report only knows about stops ≥5 min; this catches "pulled into
 *  the gas station 3 minutes ago" so the AI never says "moving at 54 mph"
 *  off a fix from before the driver parked. */
async function currentDwell(assetId: string): Promise<{ minutes: number; lat: number; lng: number } | null> {
  try {
    const { createClient } = await import('./supabase-server')
    const supabase = createClient()
    const sinceIso = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data } = await supabase
      .from('asset_locations')
      .select('lat, lng, speed, timestamp')
      .eq('asset_id', assetId)
      .gte('timestamp', sinceIso)
      .order('timestamp', { ascending: false })
      .limit(200)
    if (!data?.length) return null
    const newest = data[0]
    const newestMs = Date.parse(newest.timestamp)
    // Data too stale to make a live claim either way.
    if (Date.now() - newestMs > 15 * 60_000) return null
    if ((newest.speed ?? 0) >= 2) return null
    const kx = 111_320 * Math.cos((newest.lat * Math.PI) / 180)
    let earliest = newestMs
    for (const r of data) {
      const dist = Math.hypot((r.lng - newest.lng) * kx, (r.lat - newest.lat) * 110_540)
      if ((r.speed ?? 0) >= 2 || dist > 120) break
      earliest = Date.parse(r.timestamp)
    }
    const minutes = Math.round((Date.now() - earliest) / 60_000)
    return minutes >= 2 ? { minutes, lat: newest.lat, lng: newest.lng } : null
  } catch { return null }
}

async function runFleetSnapshot(ctx: AiToolCtx) {
  const { assets, geofences } = ctx
  const rings = geofences
    .filter((g) => g.kind !== 'boundary')
    .map((g) => ({ name: g.name, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))
  return Promise.all(assets.map(async (a) => {
    const loc = a.location
    const site = loc
      ? rings.find((r) => r.ring.length >= 3 && pointInPolygon([loc.lng, loc.lat], r.ring))?.name ?? null
      : null
    const raw = (loc?.raw ?? {}) as Record<string, unknown>
    const fuelPct = typeof raw['fuel.level'] === 'number' ? Math.round(raw['fuel.level'] as number) : null
    const rpm = typeof raw['engine.rpm'] === 'number' ? (raw['engine.rpm'] as number) : null
    const ageMin = loc ? Math.max(0, Math.round((Date.now() - new Date(loc.timestamp).getTime()) / 60_000)) : null
    // Live dwell check for powered assets that aren't clearly mid-drive on a
    // FRESH fix — catches "parked 3 minutes ago, tracker's last packet was
    // still doing 54 mph" (devices report on a lag around ignition-off).
    const mightBeStopped = (a.type === 'vehicle' || a.type === 'equipment') && loc != null
    const dwell = mightBeStopped ? await currentDwell(a.id) : null
    let stoppedAt: { place: string; kind: string; minutes: number } | undefined
    if (dwell) {
      try {
        const { classifyPoint } = await import('./poi-server')
        const p = await classifyPoint(dwell.lat, dwell.lng)
        stoppedAt = { place: p.name, kind: p.kind, minutes: dwell.minutes }
      } catch { stoppedAt = { place: 'current location', kind: 'other', minutes: dwell.minutes } }
    }
    return {
      name: a.name,
      type: a.type,
      site: site ?? (loc ? 'off-site' : 'no signal'),
      speedMph: loc?.speed ?? null,
      // Only claim movement off a FRESH fix. Vehicles stream every few
      // seconds while driving, so a moving fix >3 min old means the truck
      // almost certainly parked (ignition-off kills transmission mid-speed).
      // Equipment reports ~5-min intervals, so allow 12.
      moving: (loc?.speed ?? 0) > 2 && (ageMin ?? 99) < (a.type === 'vehicle' ? 3 : 12) && !stoppedAt,
      // Verified sitting-still-right-now: where and for how long.
      stoppedAt,
      batteryPct: loc?.battery ?? null,
      fuelPct,
      engineOn: rpm != null ? rpm > 300 : typeof raw['engine.ignition.status'] === 'boolean' ? raw['engine.ignition.status'] : null,
      lastSeen: loc ? fmtDateTime(new Date(loc.timestamp).getTime(), ctx.tz) : null,
      lastReportAgeMinutes: ageMin,
      // Owner-written notes ("V6 engine", "spare key in office") — ground truth.
      notes: typeof a.metadata?.notes === 'string' && a.metadata.notes ? String(a.metadata.notes).slice(0, 240) : undefined,
    }
  }))
}

async function runAssetActivity(ctx: AiToolCtx, input: { asset_name?: string; range?: string }) {
  const asset = matchByName(String(input.asset_name ?? ''), ctx.assets)
  if (!asset) return { error: `No asset matching "${input.asset_name}". Known assets: ${ctx.assets.map((a) => a.name).join(', ')}` }
  const key = (['today', 'yesterday', '7d', '30d', 'ytd', 'all'].includes(String(input.range)) ? input.range : '7d') as TimeRangeKey

  const { createClient } = await import('./supabase-server')
  const supabase = createClient()
  // Page past Supabase's Max-Rows cap, newest-first, then restore order.
  const PAGE = 1000
  const CAP = 40_000
  const rows: { lat: number; lng: number; speed: number | null; timestamp: string; ignition?: boolean | null }[] = []
  while (rows.length < CAP) {
    const { data, error } = await supabase
      .from('asset_locations')
      .select('lat, lng, speed, timestamp, ignition')
      .eq('asset_id', asset.id)
      .order('timestamp', { ascending: false })
      .range(rows.length, rows.length + PAGE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  const pts: StatPoint[] = rows
    .reverse()
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, ms: Date.parse(r.timestamp), ign: r.ignition ?? null }))
    .filter((p) => Number.isFinite(p.ms))
  const earliestMs = pts.length ? pts[0].ms : null
  const w = rangeWindow(ctx.tz, key, { earliestMs })
  const md = (asset.metadata ?? {}) as Record<string, unknown>
  const estMpg = estMpgForSpecs((md.specs as Record<string, unknown> | undefined) ?? md, asset.name)
  const stats = computeRangeStats(pts, w.from, w.to, earliestMs, Date.now(), estMpg)
  return {
    asset: asset.name,
    range: key,
    ...stats,
    fuelNote: `fuelGalEst is an estimate (${estMpg} mpg driving + 0.6 gal/h idling)`,
    dataTruncated: rows.length >= CAP,
  }
}

async function runSiteVisits(ctx: AiToolCtx, input: { zone_name?: string; days?: number }) {
  const zone = matchByName(String(input.zone_name ?? ''), ctx.geofences)
  if (!zone) return { error: `No zone matching "${input.zone_name}". Known zones: ${ctx.geofences.map((g) => g.name).join(', ')}` }
  const days = Math.min(14, Math.max(1, Math.round(Number(input.days) || 7)))
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString()
  const nameOf = (id: string) => ctx.assets.find((a) => a.id === id)?.name ?? 'Unknown asset'

  // EXACT LEDGER first (zone_sessions, migration 056) — the same source the
  // zone page shows, so the assistant never disagrees with it. The old raw
  // ping sweep was row-capped newest-first, which silently shrank "this
  // week" to the newest day or so of data (Brian, Aug 22: multi-day visits
  // all reported as one date).
  const { createClient } = await import('./supabase-server')
  const zs = await createClient()
    .from('zone_sessions')
    .select('asset_id, entered_at, exited_at')
    .eq('geofence_id', zone.id)
    .gte('entered_at', sinceIso)
    .order('entered_at', { ascending: false })
    .limit(400)
  if (!zs.error) {
    // Sessions are closed intervals stamped by the hourly cron — an end
    // within the last ~75 min means "still on site" (zone-page convention).
    const now = Date.now()
    const STILL_MS = 75 * 60_000
    return {
      zone: zone.name,
      zone_notes: zone.notes || undefined,
      days,
      visits: (zs.data ?? []).slice(0, 40).map((s) => {
        const enterMs = new Date(s.entered_at).getTime()
        const exitMs = new Date(s.exited_at).getTime()
        const still = now - exitMs < STILL_MS
        return {
          asset: nameOf(s.asset_id),
          arrived: fmtDateTime(enterMs, ctx.tz),
          left: still ? 'still on site' : fmtDateTime(exitMs, ctx.tz),
          minutes: Math.round(((still ? now : exitMs) - enterMs) / 60_000),
        }
      }),
      note: 'Visit ledger updates hourly, and sleeping trackers check in about hourly — the last 1-2 hours may not be reflected yet.',
    }
  }

  // Pre-056 fallback: segment raw pings (row-capped; fine for small fleets).
  const { getLocationHistory } = await import('./db/assets')
  const history = await getLocationHistory(ctx.companyId, sinceIso)
  if (!history?.length) return { zone: zone.name, days, visits: [] }

  const ring = (zone.geometry?.coordinates?.[0] ?? []) as [number, number][]
  const visits = segmentVisits(history as VisitPoint[], ring)
  return {
    zone: zone.name,
    zone_notes: zone.notes || undefined,
    days,
    visits: visits.slice(0, 40).map((v) => ({
      asset: nameOf(v.assetId),
      arrived: fmtDateTime(v.enterMs, ctx.tz),
      left: v.exitMs ? fmtDateTime(v.exitMs, ctx.tz) : 'still on site',
      minutes: v.minutes,
    })),
    note: 'Computed from a capped sample of recent GPS pings — older days in the window may be incomplete.',
  }
}

async function runAssetStops(ctx: AiToolCtx, input: { asset_name?: string; range?: string }) {
  const asset = matchByName(String(input.asset_name ?? ''), ctx.assets)
  if (!asset) return { error: `No asset matching "${input.asset_name}". Known assets: ${ctx.assets.map((a) => a.name).join(', ')}` }
  const key = (['today', 'yesterday', '7d'].includes(String(input.range)) ? input.range : 'today') as TimeRangeKey
  const w = rangeWindow(ctx.tz, key, {})

  const { createClient } = await import('./supabase-server')
  const supabase = createClient()
  const PAGE = 1000
  const rows: { lat: number; lng: number; speed: number | null; timestamp: string }[] = []
  while (rows.length < 20_000) {
    const { data, error } = await supabase
      .from('asset_locations')
      .select('lat, lng, speed, timestamp')
      .eq('asset_id', asset.id)
      .gte('timestamp', new Date(w.from).toISOString())
      .lt('timestamp', new Date(w.to).toISOString())
      .order('timestamp', { ascending: false })
      .range(rows.length, rows.length + PAGE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  const raw = segmentStops(rows.reverse())
  const rings = ctx.geofences
    .filter((g) => g.kind !== 'boundary')
    .map((g) => ({ name: g.name, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))
  const stops = await classifyStops(raw, rings, pointInPolygon)
  return {
    asset: asset.name,
    range: key,
    stops: stops.map((s) => ({
      arrived: fmtDateTime(s.fromMs, ctx.tz),
      left: fmtDateTime(s.toMs, ctx.tz),
      minutes: s.minutes,
      place: s.name,
      kind: s.kind,
    })),
  }
}

async function runAssetTelemetry(ctx: AiToolCtx, input: { asset_name?: string }) {
  const asset = matchByName(String(input.asset_name ?? ''), ctx.assets)
  if (!asset) return { error: `No asset matching "${input.asset_name}". Known assets: ${ctx.assets.map((a) => a.name).join(', ')}` }
  const loc = asset.location
  if (!loc) return { asset: asset.name, error: 'No telemetry yet — the tracker has never reported.' }
  // The full parameter bag from the latest fix. Keys are generic telemetry
  // names; scalars only, and BLE noise trimmed to keep the payload tight.
  const params: Record<string, unknown> = {}
  for (const [k, v] of Object.entries((loc.raw ?? {}) as Record<string, unknown>)) {
    if (k.startsWith('ble.') || k === 'source') continue
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') params[k] = v
  }
  return {
    asset: asset.name,
    notes: typeof asset.metadata?.notes === 'string' && asset.metadata.notes ? String(asset.metadata.notes).slice(0, 400) : undefined,
    reportedAt: fmtDateTime(new Date(loc.timestamp).getTime(), ctx.tz),
    speedMph: loc.speed,
    batteryPct: loc.battery,
    params,
    note: 'Odometer values are meters; fuel.level is percent of tank; battery.voltage is the 12V system.',
  }
}

const ROAD_FACTOR = 1.25 // straight-line → road miles, rural/suburban typical
const ASSUMED_MPH = 35   // parked asset: "if it left now" pace

async function runEtaToZone(ctx: AiToolCtx, input: { asset_name?: string; zone_name?: string }) {
  const asset = matchByName(String(input.asset_name ?? ''), ctx.assets)
  if (!asset) return { error: `No asset matches. Assets: ${ctx.assets.map((a) => a.name).join(', ')}` }
  if (!asset.location) return { error: `${asset.name} has never reported a position.` }
  const zone = matchByName(String(input.zone_name ?? ''), ctx.geofences)
  if (!zone) return { error: `No zone matches. Zones: ${ctx.geofences.map((g) => g.name).join(', ')}` }
  const ring = (zone.geometry?.coordinates?.[0] ?? []) as [number, number][]
  if (ring.length < 3) return { error: `${zone.name} has no drawn boundary.` }

  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
  const { lat, lng, speed } = asset.location
  if (pointInPolygon([lng, lat], ring)) {
    return { asset: asset.name, zone: zone.name, status: 'already inside the zone' }
  }

  const R = 3958.8
  const dLat = ((cy - lat) * Math.PI) / 180
  const dLng = ((cx - lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((lat * Math.PI) / 180) * Math.cos((cy * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  const straightMi = 2 * R * Math.asin(Math.sqrt(h))
  const roadMi = straightMi * ROAD_FACTOR

  const moving = (speed ?? 0) > 5
  const mph = moving ? speed! : ASSUMED_MPH
  const etaMin = Math.max(1, Math.round((roadMi / mph) * 60))
  return {
    asset: asset.name,
    zone: zone.name,
    zone_notes: zone.notes || undefined,
    distance_miles_approx: Math.round(roadMi * 10) / 10,
    currently: moving ? `moving at ${Math.round(speed!)} mph` : 'not moving',
    speed_basis: moving ? `current ${Math.round(speed!)} mph` : `assumed ${ASSUMED_MPH} mph if it leaves now`,
    eta_minutes_approx: etaMin,
    arrival_time_approx: fmtDateTime(Date.now() + etaMin * 60_000, ctx.tz),
    caveat: 'straight-line distance × 1.25 road factor — a rough ETA, not turn-by-turn routing',
  }
}

async function runRecentAlerts(ctx: AiToolCtx, input: { limit?: number }) {
  const limit = Math.min(25, Math.max(1, Math.round(Number(input.limit) || 10)))
  return ctx.alerts.slice(0, limit).map((a) => ({
    asset: a.asset?.name ?? 'Unknown asset',
    trigger: (a.rule?.trigger ?? 'alert').replace(/_/g, ' '),
    zone: a.rule?.geofence?.name ?? null,
    at: fmtDateTime(new Date(a.triggered_at).getTime(), ctx.tz),
    acknowledged: !!a.acknowledged_at,
  }))
}

/** Crew daily logs + who/where context, compact for the model. */
async function runDailyLogs(ctx: AiToolCtx, input: { days?: number; zone_name?: string }): Promise<unknown> {
  const days = Math.min(14, Math.max(1, Math.round(input.days ?? 3)))
  const { createClient } = await import('./supabase-server')
  const supabase = createClient()
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString()
  const [logsQ, entriesQ] = await Promise.all([
    supabase.from('daily_logs').select('*').eq('company_id', ctx.companyId)
      .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(60),
    supabase.from('time_entries').select('id, person_name, category, project_geofence_id, plan, clock_in_at, clock_out_at')
      .eq('company_id', ctx.companyId).gte('clock_in_at', sinceIso).limit(300),
  ])
  if (logsQ.error) return { error: 'Daily logs are not set up yet (run migration 015).' }
  const entries = new Map((entriesQ.data ?? []).map((e) => [e.id as string, e]))
  const zoneFilter = input.zone_name ? matchByName(input.zone_name, ctx.geofences) : null
  if (input.zone_name && !zoneFilter) {
    return { error: `No zone matches "${input.zone_name}"`, zones: ctx.geofences.map((g) => g.name) }
  }
  const rows = (logsQ.data ?? []).flatMap((l) => {
    const entry = entries.get(l.time_entry_id as string)
    const zone = ctx.geofences.find((g) => g.id === entry?.project_geofence_id)
    if (zoneFilter && zone?.id !== zoneFilter.id) return []
    const hours = entry?.clock_out_at && entry?.clock_in_at
      ? Math.round((new Date(entry.clock_out_at as string).getTime() - new Date(entry.clock_in_at as string).getTime()) / 360_000) / 10
      : null
    const answers = Array.isArray(l.answers)
      ? Object.fromEntries((l.answers as { label: string; value: unknown }[]).map((a) => [a.label, a.value]))
      : {}
    return [{
      person: (entry?.person_name as string) ?? 'Crew',
      site: zone?.name ?? (entry?.category as string) ?? null,
      submitted: fmtDateTime(new Date(l.created_at as string).getTime(), ctx.tz),
      hours_clocked: hours,
      plan: (entry?.plan as string) || null,
      writeup: String(l.writeup ?? '').slice(0, 600),
      safety: String(l.safety ?? '') || null,
      trucks_fueled: l.trucks_fueled as boolean | null,
      equipment_fueled: l.equipment_fueled as boolean | null,
      ...(Object.keys(answers).length ? { form_answers: answers } : {}),
      photos: Array.isArray(l.photos) ? (l.photos as unknown[]).length : 0,
    }]
  })
  return rows.length ? rows : { note: `No daily logs in the last ${days} day(s)${zoneFilter ? ` for ${zoneFilter.name}` : ''}.` }
}

/** Execute one tool call. Never throws — errors return as {error} so the
 *  model can recover ("no such asset — here's the list"). */
export async function runAiTool(name: string, input: Record<string, unknown>, ctx: AiToolCtx): Promise<unknown> {
  try {
    // Shared MCP registry tools — same executors as the Agent Interface.
    // The permission check runs HERE too (not just at def-list time): a
    // model must never reach dollars a hidden tool def alone would allow.
    if (SHARED_MCP_TOOLS.includes(name)) {
      if (COST_GATED_TOOLS.has(name) && !ctx.canViewCosts) {
        return { error: 'This user does not have the cost-visibility permission — answer without dollar figures.' }
      }
      const res = await runMcpTool(name, input, ctx.companyId)
      const text = res.content[0]?.text ?? ''
      if (res.isError) return { error: text || 'tool failed' }
      try { return JSON.parse(text) } catch { return { result: text } }
    }
    switch (name) {
      case 'fleet_snapshot': return await runFleetSnapshot(ctx)
      case 'asset_activity': return await runAssetActivity(ctx, input as { asset_name?: string; range?: string })
      case 'asset_stops': return await runAssetStops(ctx, input as { asset_name?: string; range?: string })
      case 'asset_telemetry': return await runAssetTelemetry(ctx, input as { asset_name?: string })
      case 'site_visits': return await runSiteVisits(ctx, input as { zone_name?: string; days?: number })
      case 'eta_to_zone': return await runEtaToZone(ctx, input as { asset_name?: string; zone_name?: string })
      case 'recent_alerts': return await runRecentAlerts(ctx, input as { limit?: number })
      case 'daily_logs': return await runDailyLogs(ctx, input as { days?: number; zone_name?: string })
      default: return { error: `Unknown tool ${name}` }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'tool failed' }
  }
}
