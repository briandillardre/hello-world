/**
 * HammerTrack Agent Interface — MCP tool registry + executors (v1, read-only).
 *
 * Served by app/api/mcp/route.ts to ANY MCP-capable assistant (Claude,
 * ChatGPT, …) holding a per-company API key. Every executor queries through
 * the SERVICE client with an explicit company_id filter on every table —
 * there is no user session on this path, so RLS can't do the scoping; the
 * authenticated company id from the key IS the tenant boundary. A company
 * key equals admin-grade access, dollars included (see docs/AGENT-INTERFACE.md).
 *
 * Numbers come from the same shared math the UI uses (usageFromLedger,
 * computeStatus, pointInPolygon) so the customer's assistant never disagrees
 * with the screens. Executor failures return { isError: true } tool results,
 * never a thrown 500.
 */
import type { AssetType, Geofence } from './types'
import { pointInPolygon } from './alerts-engine'
import { computeStatus, type MaintenanceStatus } from './db/maintenance'
import { usageFromLedger } from './costs'
import { dayKey, fmtDateTime, isDayKey, DEFAULT_TZ } from './dates'
import { getTimeCards, weekOf } from './db/timecards'
import { FLAG_LABEL, categoryLabel } from './timecards'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// ── Hard limits ──────────────────────────────────────────────────────────────
const ASSET_ROW_CAP = 500
const ALERT_ROW_CAP = 200
const LEDGER_ROW_CAP = 50_000
/** Whole-executor budget — a slow query returns a polite tool error, not a
 *  hung connection. */
const TOOL_BUDGET_MS = 10_000

// ── MCP shapes ───────────────────────────────────────────────────────────────

export interface McpToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

const ok = (data: unknown): McpToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
})
const fail = (message: string): McpToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

// ── Tool registry (JSON Schema per the MCP spec) ─────────────────────────────

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: 'list_assets',
    description:
      'Every asset in the fleet: name, type (vehicle/equipment/personnel/tool), active flag, last known position (lat/lng + minutes since the last report), current speed and whether it is moving right now, and the name of the zone/site it is currently inside (if any) — plus `siteStacks`: per site, how many trucks / machines / people are there right now, how many are moving, and their names (a property boundary is a perimeter, not a site). Use for "where is…", "what is at…", "what is on the Creekside site", "what is moving" questions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_zone_costs',
    description:
      'Tracked machine hours and machine cost per job-site zone from the exact-hours usage ledger, plus the project budget when one is set, and the top assets by cost. Costs are dollars — the company API key is admin-grade, so this returns real money figures. Omit "zone" for all site zones.',
    inputSchema: {
      type: 'object',
      properties: {
        zone: { type: 'string', description: 'Zone/site name (partial ok) or zone id. Omit for all site zones.' },
        days: { type: 'number', description: 'Window in days, counting back from today (default 7, max 90).' },
      },
      required: [],
    },
  },
  {
    name: 'list_alerts',
    description:
      'Recent alert events — after-hours/theft movement, left-site, geofence entry/exit, idle, low fuel/battery — with the asset name, trigger kind, zone, time, and whether acknowledged. Use for any security/theft/alerts question.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'How many days back (default 7, max 30).' },
        limit: { type: 'number', description: 'Max events to return (default 50, max 200).' },
      },
      required: [],
    },
  },
  {
    name: 'maintenance_status',
    description:
      'Service health across the fleet: maintenance schedules that are OVERDUE or DUE SOON (with the asset name, interval, and current reading) plus open work orders (title, asset, priority, status, due date, reading). Use for "anything overdue for service?", "open work orders?" questions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'find_tool',
    description:
      'Locate a Bluetooth-tagged tool by name: which truck/equipment gateway it last rode with, when it was last seen, its last known coordinates, and its recent carrier history. Tools have no GPS of their own — they inherit the location of whatever detected them.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name, partial match ok (e.g. "demo saw").' },
      },
      required: ['name'],
    },
  },
  {
    name: 'whats_worth_a_look',
    description:
      'The insight engine\'s current findings for this company: budget overruns, cost running over the recent normal, idle machines burning ownership dollars, after-hours movement trends, missing receipts — each with the evidence numbers behind it. Findings are computed nightly from the usage ledger (never guessed). Use for "what should I look at", "how are we doing", "anything I should know", "any problems" questions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'recent_photos',
    description:
      'Geotagged job photos the crew took (camera shots from the map and daily-log photos), newest first: when, who, which site zone it fell in, the caption, and the image URL. Use it to see what a site looked like on a day, prove work happened, or count how much the crew is documenting per site.',
    inputSchema: {
      type: 'object',
      properties: {
        zone: { type: 'string', description: 'Site/zone name (partial ok). Omit for every site.' },
        days: { type: 'number', description: 'Window in days, counting back from today (default 7, max 90).' },
        limit: { type: 'number', description: 'Max photos to return (default 40, max 200).' },
      },
      required: [],
    },
  },
  {
    name: 'time_cards',
    description:
      'Crew time cards (migration 103): per person, paid hours split regular / overtime (over 40 h in the window — pass `week` for a payroll read), hours by job site, whether they are clocked in right now, and how GPS-verified the hours are (the phone\'s fixes during each shift and the share that fell inside the clocked job site). Each day lists its entries: clock-in / clock-out times, where those happened, unpaid break, and plain flags (Still clocked in, No GPS, Mostly off-site, Long shift, Edited, No job site). Use for "who worked where this week", "how many hours did X put in", "is anyone still clocked in", "were the hours actually on site", payroll and overtime questions.',
    inputSchema: {
      type: 'object',
      properties: {
        week: { type: 'string', description: 'Any date (YYYY-MM-DD) inside the Monday–Sunday pay week wanted; overrides days.' },
        days: { type: 'number', description: 'Rolling window in days ending now (default 7, max 62).' },
        person: { type: 'string', description: 'Only this person (partial name ok). Omit for the whole crew.' },
      },
      required: [],
    },
  },
]

// ── Shared helpers ───────────────────────────────────────────────────────────

async function service() {
  const { createServiceClient } = await import('./supabase-server')
  return createServiceClient()
}

/** Longest-name fuzzy match — same behavior as the in-app AI dispatcher. */
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

interface ZoneRing { id: string; name: string; kind: string; ring: [number, number][] }

function toRings(geofences: Pick<Geofence, 'id' | 'name' | 'kind' | 'geometry'>[]): ZoneRing[] {
  return geofences
    .map((g) => ({
      id: g.id,
      name: g.name,
      kind: g.kind ?? 'site',
      ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][],
    }))
    .filter((g) => g.ring.length >= 3)
    // Sites/yards/vendors before boundaries: a big property boundary wrapped
    // around a site must not steal the containment answer.
    .sort((a, b) => Number(a.kind === 'boundary') - Number(b.kind === 'boundary'))
}

interface GeofenceRow {
  id: string
  name: string
  kind: string | null
  geometry: { coordinates: unknown[] } | null
  budget: number | string | null
  notes: string | null
}

async function getCompanyGeofences(companyId: string): Promise<GeofenceRow[]> {
  if (isMock) {
    const { MOCK_GEOFENCES } = await import('./mock-data')
    return MOCK_GEOFENCES.map((g) => ({
      id: g.id, name: g.name, kind: g.kind ?? 'site',
      geometry: g.geometry as unknown as { coordinates: unknown[] },
      budget: g.budget ?? null, notes: g.notes ?? null,
    }))
  }
  const sb = await service()
  const { data, error } = await sb
    .from('geofences_json')
    .select('id, name, kind, geometry, budget, notes')
    .eq('company_id', companyId)
  if (error) return []
  return (data ?? []) as GeofenceRow[]
}

interface AssetRow {
  id: string
  name: string
  type: AssetType
  active: boolean
  hourly_rate: number | null
  mileage_rate: number | null
  daily_cost: number | null
  location: { lat: number; lng: number; speed: number | null; battery: number | null; timestamp: string } | null
}

async function getCompanyAssets(companyId: string): Promise<AssetRow[]> {
  if (isMock) {
    const { MOCK_ASSETS } = await import('./mock-data')
    return MOCK_ASSETS.slice(0, ASSET_ROW_CAP).map((a) => ({
      id: a.id, name: a.name, type: a.type, active: a.active,
      hourly_rate: a.hourly_rate ?? null, mileage_rate: a.mileage_rate ?? null, daily_cost: a.daily_cost ?? null,
      location: a.location
        ? { lat: a.location.lat, lng: a.location.lng, speed: a.location.speed, battery: a.location.battery, timestamp: a.location.timestamp }
        : null,
    }))
  }
  const sb = await service()
  const { data, error } = await sb
    .from('assets')
    .select(`
      id, name, type, active, hourly_rate, mileage_rate, daily_cost,
      location:asset_locations(lat, lng, speed, battery, timestamp)
    `)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    // Newest fix only — unordered embeds return an arbitrary historical row
    // (same trap getAssetsWithLocations documents).
    .order('timestamp', { ascending: false, referencedTable: 'asset_locations' })
    .limit(1, { referencedTable: 'asset_locations' })
    .limit(ASSET_ROW_CAP)
  if (error) return []
  type Row = Omit<AssetRow, 'location'> & { location: AssetRow['location'][] | AssetRow['location'] | null }
  return ((data ?? []) as unknown as Row[]).map((a) => ({
    ...a,
    location: Array.isArray(a.location) ? a.location[0] ?? null : (a.location ?? null),
  }))
}

// ── Executors ────────────────────────────────────────────────────────────────

async function runListAssets(companyId: string): Promise<McpToolResult> {
  const [assets, geofences] = await Promise.all([
    getCompanyAssets(companyId),
    getCompanyGeofences(companyId),
  ])
  const rings = toRings(geofences as unknown as Geofence[])
  const now = Date.now()
  const out = assets.map((a) => {
    const loc = a.location
    const ageMin = loc ? Math.max(0, Math.round((now - Date.parse(loc.timestamp)) / 60_000)) : null
    const ring = loc ? rings.find((r) => pointInPolygon([loc.lng, loc.lat], r.ring)) : undefined
    const zone = ring?.name ?? null
    const zoneKind = ring?.kind ?? null
    // Only claim movement off a FRESH fix (vehicles stream seconds apart while
    // driving; equipment reports ~5-min intervals) — same rule as the in-app AI.
    const moving = (loc?.speed ?? 0) > 2 && (ageMin ?? 99) < (a.type === 'vehicle' ? 3 : 12)
    return {
      name: a.name,
      type: a.type,
      active: a.active,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      lastReportAgeMinutes: ageMin,
      lastSeen: loc ? fmtDateTime(Date.parse(loc.timestamp), DEFAULT_TZ) : null,
      speedMph: loc?.speed ?? null,
      moving,
      batteryPct: loc?.battery ?? null,
      zone: zone ?? (loc ? 'off-site' : 'no signal'),
      zoneKind,
    }
  })
  // Stacks (Sep 9 — Brian: "multiple items in one general area"): what is
  // piled on each site right now, by kind, so an assistant can answer "what
  // is at Creekside" without walking the list. Boundaries are perimeters,
  // not places, so they never stack.
  // (Tools ride a carrier and have no fix of their own here — they show up as
  // the carrier's hauling count on the map, not as members of a stack.)
  const kindOf = (t: string): 'trucks' | 'machines' | 'people' | null => t === 'vehicle' ? 'trucks' : t === 'equipment' ? 'machines' : t === 'personnel' ? 'people' : null
  const stacks = new Map<string, { site: string; count: number; trucks: number; machines: number; people: number; moving: number; names: string[] }>()
  let offSite = 0
  for (const a of out) {
    if (a.lat == null) continue
    // A property boundary is a perimeter, not a place — inside it but on no
    // site counts as off-site.
    if (a.zone === 'off-site' || a.zoneKind === 'boundary') { offSite++; continue }
    const kind = kindOf(a.type)
    if (!kind) continue
    const st = stacks.get(a.zone) ?? { site: a.zone, count: 0, trucks: 0, machines: 0, people: 0, moving: 0, names: [] }
    st.count++
    st[kind]++
    if (a.moving) st.moving++
    if (st.names.length < 12) st.names.push(a.name)
    stacks.set(a.zone, st)
  }
  const siteStacks = Array.from(stacks.values()).sort((x, y) => y.count - x.count)
  return ok({ assets: out, siteStacks, offSite, truncated: assets.length >= ASSET_ROW_CAP, timezone: DEFAULT_TZ })
}

interface LedgerRow { geofence_id: string; asset_id: string; day: string; on_site_secs: number; active_secs: number }

async function runGetZoneCosts(companyId: string, args: { zone?: unknown; days?: unknown }): Promise<McpToolResult> {
  const days = Math.min(90, Math.max(1, Math.round(Number(args.days) || 7)))
  const geofences = await getCompanyGeofences(companyId)
  const billableZones = geofences.filter((g) => (g.kind ?? 'site') !== 'boundary')

  let zones: GeofenceRow[]
  const q = typeof args.zone === 'string' ? args.zone.trim() : ''
  if (q) {
    const byId = billableZones.find((g) => g.id === q)
    const match = byId ?? matchByName(q, billableZones)
    if (!match) {
      return fail(`No zone matching "${q}". Known zones: ${billableZones.map((g) => g.name).join(', ') || '(none yet)'}`)
    }
    zones = [match]
  } else {
    zones = billableZones.filter((g) => (g.kind ?? 'site') === 'site')
  }
  if (zones.length === 0) return ok({ days, zones: [], note: 'No site zones drawn yet.' })

  if (isMock) {
    return ok({
      days,
      zones: zones.map((g) => ({ zone: g.name, budget: g.budget == null ? null : Number(g.budget) })),
      note: 'Demo mode — no usage ledger exists, so hours/cost are unavailable here. The live product prices tracked machine time from the exact-hours ledger.',
    })
  }

  const sb = await service()
  const cutoffKey = dayKey(Date.now() - (days - 1) * 86_400_000, DEFAULT_TZ)
  const [assets, ledgerRes] = await Promise.all([
    getCompanyAssets(companyId),
    sb.from('usage_daily')
      .select('geofence_id, asset_id, day, on_site_secs, active_secs')
      .eq('company_id', companyId)
      .gte('day', cutoffKey)
      .limit(LEDGER_ROW_CAP),
  ])
  // Pre-056 database: the ledger table doesn't exist yet.
  const ledger: LedgerRow[] = ledgerRes.error ? [] : ((ledgerRes.data ?? []) as LedgerRow[])

  const byZone = new Map<string, LedgerRow[]>()
  for (const r of ledger) {
    const rows = byZone.get(r.geofence_id)
    if (rows) rows.push(r)
    else byZone.set(r.geofence_id, [r])
  }

  // Same "set rates" honesty as the map's burn chips: $0 with no rates set is
  // a lie, so say which it is.
  const billable = assets.filter((a) => a.type !== 'tool' && a.active !== false)
  const rated = billable.filter((a) => (a.hourly_rate ?? 0) > 0 || (a.mileage_rate ?? 0) > 0 || (a.daily_cost ?? 0) > 0)
  const rateCoverage = rated.length === 0 ? 'none' : rated.length === billable.length ? 'full' : 'partial'

  const round2 = (n: number) => Math.round(n * 100) / 100
  const round1 = (n: number) => Math.round(n * 10) / 10
  const out = zones.map((g) => {
    // Same house pricing function as the zone page + map chips (usageFromLedger).
    const usage = usageFromLedger(byZone.get(g.id) ?? [], assets)
    const cost = usage.reduce((s, u) => s + u.amount, 0)
    const activeHours = usage.reduce((s, u) => s + u.activeHours, 0)
    const presentHours = usage.reduce((s, u) => s + u.presentHours, 0)
    const budgetNum = g.budget == null ? NaN : Number(g.budget)
    return {
      zone: g.name,
      kind: g.kind ?? 'site',
      machineCost: round2(cost),
      activeHours: round1(activeHours),
      presentHours: round1(presentHours),
      budget: Number.isFinite(budgetNum) ? budgetNum : null,
      topAssets: usage.slice(0, 5).map((u) => ({
        name: u.name, type: u.type, activeHours: round1(u.activeHours), amount: round2(u.amount),
      })),
    }
  })
  return ok({
    days,
    rateCoverage,
    zones: out,
    note: rateCoverage === 'none'
      ? 'No cost rates are set on any asset yet, so dollar figures are $0 — hours are real. Set hourly/daily rates on assets to price tracked time.'
      : `Machine cost = tracked time priced from per-asset rates (days are ${DEFAULT_TZ} calendar days). Labor and receipts are not included here.`,
  })
}

async function runListAlerts(companyId: string, args: { days?: unknown; limit?: unknown }): Promise<McpToolResult> {
  const days = Math.min(30, Math.max(1, Math.round(Number(args.days) || 7)))
  const limit = Math.min(ALERT_ROW_CAP, Math.max(1, Math.round(Number(args.limit) || 50)))
  const sinceMs = Date.now() - days * 86_400_000

  if (isMock) {
    const { MOCK_ALERTS } = await import('./mock-data')
    const rows = MOCK_ALERTS
      .filter((a) => Date.parse(a.triggered_at) >= sinceMs)
      .slice(0, limit)
      .map((a) => ({
        kind: (a.kind ?? a.rule?.trigger ?? 'alert').replace(/_/g, ' '),
        asset: a.asset?.name ?? 'Unknown asset',
        zone: a.rule?.geofence?.name ?? null,
        at: fmtDateTime(Date.parse(a.triggered_at), DEFAULT_TZ),
        acknowledged: !!a.acknowledged_at,
      }))
    return ok({ days, alerts: rows, timezone: DEFAULT_TZ })
  }

  const sb = await service()
  const { data, error } = await sb
    .from('alert_events')
    .select(`
      kind, triggered_at, acknowledged_at,
      asset:assets(name, type),
      rule:alert_rules(trigger, geofence:geofences(name))
    `)
    .eq('company_id', companyId)
    .gte('triggered_at', new Date(sinceMs).toISOString())
    .order('triggered_at', { ascending: false })
    .limit(limit)
  if (error) return fail('Alerts are unavailable right now.')

  interface Row {
    kind: string | null
    triggered_at: string
    acknowledged_at: string | null
    asset: { name: string; type: string } | { name: string; type: string }[] | null
    rule: { trigger: string; geofence: { name: string } | { name: string }[] | null } | { trigger: string; geofence: { name: string } | { name: string }[] | null }[] | null
  }
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)
  const rows = ((data ?? []) as unknown as Row[]).map((a) => {
    const rule = one(a.rule)
    return {
      kind: (a.kind ?? rule?.trigger ?? 'alert').replace(/_/g, ' '),
      asset: one(a.asset)?.name ?? 'Unknown asset',
      zone: one(rule?.geofence ?? null)?.name ?? null,
      at: fmtDateTime(Date.parse(a.triggered_at), DEFAULT_TZ),
      acknowledged: !!a.acknowledged_at,
    }
  })
  return ok({ days, alerts: rows, truncated: rows.length >= limit, timezone: DEFAULT_TZ })
}

async function runMaintenanceStatus(companyId: string): Promise<McpToolResult> {
  const assets = await getCompanyAssets(companyId)
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? 'Unknown asset'

  // Schedules — same computeStatus math (and reading fallback) as the
  // maintenance page and the map's wrench badges.
  let schedules: { asset_id: string; interval_type: string; interval_value: number; last_service_value: number; last_service_date: string | null; description: string; id: string; company_id: string }[] = []
  let readings: Record<string, number> = {}
  if (isMock) {
    const { MOCK_MAINTENANCE_SCHEDULES, MOCK_CURRENT_READINGS } = await import('./mock-data')
    schedules = MOCK_MAINTENANCE_SCHEDULES
    readings = MOCK_CURRENT_READINGS
  } else {
    const sb = await service()
    const { data, error } = await sb
      .from('maintenance_schedules')
      .select('*')
      .eq('company_id', companyId)
      .limit(ASSET_ROW_CAP)
    if (!error) schedules = (data ?? []) as typeof schedules
  }
  const statuses = schedules.map((s) => ({
    ...computeStatus(s as Parameters<typeof computeStatus>[0], readings[s.asset_id] ?? s.last_service_value),
    asset: nameOf(s.asset_id),
  })) as (MaintenanceStatus & { asset: string })[]
  const fmt = (s: MaintenanceStatus & { asset: string }) => ({
    asset: s.asset,
    service: s.description || 'Scheduled service',
    interval: `${s.interval_value} ${s.interval_type.replace('_', ' ')}`,
    currentValue: s.current_value,
    remaining: Math.round(s.remaining),
    status: s.status,
  })

  // Open work orders (migration 050) — degrade to empty on a pre-050 database.
  interface WoRow {
    title: string; asset_id: string | null; priority: string; status: string
    due_date: string | null; reading: number | null; created_at: string
  }
  let workOrders: WoRow[] = []
  let woAvailable = true
  if (!isMock) {
    const sb = await service()
    const { data, error } = await sb
      .from('work_orders')
      .select('title, asset_id, priority, status, due_date, reading, created_at')
      .eq('company_id', companyId)
      .not('status', 'in', '("done","canceled")')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) woAvailable = false
    else workOrders = (data ?? []) as WoRow[]
  }

  return ok({
    overdue: statuses.filter((s) => s.status === 'overdue').map(fmt),
    dueSoon: statuses.filter((s) => s.status === 'due_soon').map(fmt),
    okCount: statuses.filter((s) => s.status === 'ok').length,
    openWorkOrders: woAvailable
      ? workOrders.map((w) => ({
          title: w.title,
          asset: w.asset_id ? nameOf(w.asset_id) : null,
          priority: w.priority,
          status: w.status,
          due: w.due_date,
          reading: w.reading,
          opened: fmtDateTime(Date.parse(w.created_at), DEFAULT_TZ),
        }))
      : 'Work orders are not set up yet.',
  })
}

async function runFindTool(companyId: string, args: { name?: unknown }): Promise<McpToolResult> {
  const q = typeof args.name === 'string' ? args.name : ''
  const assets = await getCompanyAssets(companyId)
  const tools = assets.filter((a) => a.type === 'tool')
  const tool = matchByName(q, tools)
  if (!tool) {
    return fail(`No tool matching "${q}". Known tools: ${tools.map((t) => t.name).join(', ') || '(none yet)'}`)
  }
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? 'Unknown asset'

  if (isMock) {
    const { MOCK_TOOL_ASSOCIATIONS } = await import('./mock-data')
    const assoc = MOCK_TOOL_ASSOCIATIONS.find((t) => t.tool_asset_id === tool.id)
    return ok({
      tool: tool.name,
      lastCarrier: assoc ? nameOf(assoc.gateway_asset_id) : null,
      lastSeen: assoc ? fmtDateTime(Date.parse(assoc.last_seen), DEFAULT_TZ) : null,
      note: 'Tools have no GPS — this is the gateway that last detected the Bluetooth tag.',
    })
  }

  const sb = await service()
  const [assocRes, logRes] = await Promise.all([
    sb.from('tool_associations')
      .select('gateway_asset_id, last_seen, last_lat, last_lng, attached_since, tag_battery, rssi')
      .eq('company_id', companyId)
      .eq('tool_asset_id', tool.id)
      .order('last_seen', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from('pairing_log')
      .select('carrier_asset_id, started_at, last_seen, ended_at')
      .eq('company_id', companyId)
      .eq('kind', 'tool')
      .eq('member_asset_id', tool.id)
      .order('started_at', { ascending: false })
      .limit(10),
  ])
  const assoc = assocRes.error ? null : assocRes.data
  const history = logRes.error ? [] : (logRes.data ?? [])

  return ok({
    tool: tool.name,
    lastCarrier: assoc ? nameOf(assoc.gateway_asset_id as string) : null,
    lastSeen: assoc?.last_seen ? fmtDateTime(Date.parse(assoc.last_seen as string), DEFAULT_TZ) : null,
    lastLat: (assoc?.last_lat as number | null) ?? null,
    lastLng: (assoc?.last_lng as number | null) ?? null,
    ridingSince: assoc?.attached_since ? fmtDateTime(Date.parse(assoc.attached_since as string), DEFAULT_TZ) : null,
    tagBatteryPct: (assoc?.tag_battery as number | null) ?? null,
    recentCarriers: history.map((h) => ({
      carrier: nameOf(h.carrier_asset_id as string),
      from: fmtDateTime(Date.parse(h.started_at as string), DEFAULT_TZ),
      // A silent tag stopped riding at its last sighting even if arbitration
      // never wrote ended_at (same clamp as the map's custody trail).
      to: fmtDateTime(Date.parse((h.ended_at ?? h.last_seen) as string), DEFAULT_TZ),
      ongoing: h.ended_at == null,
    })),
    note: assoc
      ? 'Tools have no GPS — position is the carrier gateway\'s fix at the last Bluetooth sighting.'
      : 'This tool\'s tag has never been detected by a gateway yet.',
  })
}

/** The insight engine's live findings (lib/insights.ts) — the same rows the
 *  map's Today card and the owner digests show, so every door tells the
 *  same story. Company keys are admin-grade: money rows included. */
async function runWorthALook(companyId: string): Promise<McpToolResult> {
  const { getActiveInsights } = await import('./insights')
  const { createServiceClient } = await import('./supabase-server')
  const rows = await getActiveInsights(createServiceClient(), companyId, { limit: 6, includeMoney: true })
  if (!rows.length) {
    return ok({ note: 'Nothing out of the ordinary right now — no budget overruns, cost spikes, long-idle machines, after-hours trends, or receipt piles worth flagging.' })
  }
  return ok({
    findings: rows.map((r) => ({
      severity: r.severity,
      headline: r.headline,
      detail: r.detail ?? undefined,
      evidence: r.evidence,
      since: r.fired_at,
    })),
    note: 'Computed nightly from the usage ledger and alert history — cite the numbers as-is.',
  })
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Execute one MCP tool call, scoped to the authenticated company. Never
 * throws: executor failures (including the 10s budget) come back as
 * isError tool results the calling model can read and recover from.
 */
/** Geotagged job photos (migration 101) — the crew's own evidence of the day. */
async function runRecentPhotos(companyId: string, args: { zone?: unknown; days?: unknown; limit?: unknown }): Promise<McpToolResult> {
  const days = Math.min(90, Math.max(1, Math.round(Number(args.days) || 7)))
  const limit = Math.min(200, Math.max(1, Math.round(Number(args.limit) || 40)))
  const db = await service()
  const geofences = await getCompanyGeofences(companyId)
  let zoneId: string | null = null
  if (typeof args.zone === 'string' && args.zone.trim()) {
    const z = matchByName(args.zone, geofences as unknown as { id: string; name: string }[])
    if (!z) return ok({ photos: [], note: `No zone matches "${args.zone}".` })
    zoneId = z.id
  }
  let q = db.from('field_photos')
    .select('id, url, thumb_url, lat, lng, taken_at, caption, source, geofence_id, user_id')
    .eq('company_id', companyId)
    .gte('taken_at', new Date(Date.now() - days * 86_400_000).toISOString())
    .order('taken_at', { ascending: false })
    .limit(limit)
  if (zoneId) q = q.eq('geofence_id', zoneId)
  const [{ data: rows, error }, { data: people }] = await Promise.all([q, db.from('profiles').select('id, name').eq('company_id', companyId)])
  if (error) return ok({ photos: [], note: 'Photos are not available yet.' })
  const zoneName = new Map(geofences.map((g) => [g.id as string, g.name as string]))
  const who = new Map((people ?? []).map((p) => [p.id as string, (p.name as string) || null]))
  const perZone = new Map<string, number>()
  const photos = (rows ?? []).map((r) => {
    const zone = r.geofence_id ? zoneName.get(r.geofence_id as string) ?? null : null
    perZone.set(zone ?? 'off-site', (perZone.get(zone ?? 'off-site') ?? 0) + 1)
    return {
      takenAt: fmtDateTime(Date.parse(r.taken_at as string), DEFAULT_TZ),
      by: r.user_id ? who.get(r.user_id as string) ?? null : null,
      zone: zone ?? 'off-site',
      lat: Number(r.lat), lng: Number(r.lng),
      caption: (r.caption as string | null) ?? null,
      source: r.source,
      url: r.url as string,
      thumbUrl: (r.thumb_url as string | null) ?? null,
    }
  })
  return ok({ photos, countBySite: Object.fromEntries(perZone), days, timezone: DEFAULT_TZ })
}

async function runTimeCards(companyId: string, args: { week?: unknown; days?: unknown; person?: unknown }, userIds: string[] | null = null): Promise<McpToolResult> {
  const tz = DEFAULT_TZ
  const days = Math.min(62, Math.max(1, Math.round(Number(args.days) || 7)))
  const win = isDayKey(args.week)
    ? (() => { const w = weekOf(args.week, tz); return { fromMs: w.fromMs, toMs: w.toMs, label: `pay week of ${w.monday}` } })()
    : { fromMs: Date.now() - days * 86_400_000, toMs: Date.now(), label: `last ${days} day(s)` }
  const db = await service()
  const { cards, verified } = await getTimeCards(db, { companyId, fromMs: win.fromMs, toMs: win.toMs, tz, userIds })
  const person = typeof args.person === 'string' ? args.person.trim().toLowerCase() : ''
  const picked = person ? cards.filter((c) => c.personName.toLowerCase().includes(person)) : cards
  if (person && !picked.length && cards.length) return ok({ people: [], note: `No time card matches "${args.person}". People with hours: ${cards.map((c) => c.personName).join(', ')}.` })
  const people = picked.map((c) => ({
    person: c.personName,
    hours: c.hours,
    regular: c.regular,
    overtime: c.overtime,
    onTheClockNow: c.openNow,
    gpsVerifiedPct: c.verifiedPct,
    flags: Object.fromEntries(Object.entries(c.flags).filter(([, n]) => n > 0).map(([k, n]) => [FLAG_LABEL[k as keyof typeof FLAG_LABEL], n])),
    bySite: c.sites.map((s) => ({ site: s.label, hours: s.hours })),
    days: c.days.map((d) => ({
      day: d.dayKey,
      hours: d.hours,
      entries: d.entries.map((e) => ({
        in: fmtDateTime(Date.parse(e.inAt), tz),
        out: e.outAt ? fmtDateTime(Date.parse(e.outAt), tz) : 'still clocked in',
        paidHours: e.hours,
        breakMinutes: e.breakMinutes || undefined,
        category: categoryLabel(e.category),
        site: e.category === 'project' ? e.zoneName : undefined,
        clockedInAt: e.inPlace ?? undefined,
        clockedOutAt: e.outPlace ?? undefined,
        gpsFixes: e.gps?.fixes ?? undefined,
        onSitePct: e.onSitePct ?? undefined,
        flags: e.flags.length ? e.flags.map((f) => FLAG_LABEL[f]) : undefined,
        edited: e.edited ? { by: e.edited.by, note: e.edited.note } : undefined,
        plan: e.plan || undefined,
      })),
    })),
  }))
  return ok({
    window: { label: win.label, from: fmtDateTime(win.fromMs, tz), to: fmtDateTime(win.toMs, tz), timezone: tz },
    overtimeRule: 'hours over 40 in the window; a pay week when `week` is passed',
    gpsVerification: verified ? 'each shift: the person\'s phone fixes between clock-in and clock-out, and the share inside the clocked job site' : 'not available yet (migration 103 pending)',
    people,
    ...(people.length ? {} : { note: 'No time entries in this window.' }),
  })
}

export async function runMcpTool(
  name: string,
  args: Record<string, unknown>,
  companyId: string,
  /** Session-door narrowing (Ask AI): whose time cards the caller may read. */
  opts?: { userIds?: string[] | null },
): Promise<McpToolResult> {
  const run = async (): Promise<McpToolResult> => {
    switch (name) {
      case 'list_assets': return runListAssets(companyId)
      case 'get_zone_costs': return runGetZoneCosts(companyId, args)
      case 'list_alerts': return runListAlerts(companyId, args)
      case 'maintenance_status': return runMaintenanceStatus(companyId)
      case 'find_tool': return runFindTool(companyId, args)
      case 'whats_worth_a_look': return runWorthALook(companyId)
      case 'recent_photos': return runRecentPhotos(companyId, args)
      case 'time_cards': return runTimeCards(companyId, args, opts?.userIds ?? null)
      default: return fail(`Unknown tool "${name}". Available: ${MCP_TOOLS.map((t) => t.name).join(', ')}`)
    }
  }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined
    const budget = new Promise<McpToolResult>((resolve) => {
      timer = setTimeout(() => resolve(fail('Query budget exceeded (10s) — try a narrower window.')), TOOL_BUDGET_MS)
    })
    const result = await Promise.race([run(), budget])
    clearTimeout(timer)
    return result
  } catch {
    // Never echo internal error text (env/config messages) to callers,
    // even authenticated ones (sec-check P2-5).
    return fail('Tool failed — try again, or email support@hammertrack.ai if it keeps happening.')
  }
}

/** True when `name` is a registered tool. */
export function isMcpTool(name: string): boolean {
  return MCP_TOOLS.some((t) => t.name === name)
}
