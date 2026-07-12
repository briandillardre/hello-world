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
import { pointInPolygon } from './alerts-engine'
import { computeRangeStats, estMpgForSpecs, type StatPoint } from './asset-stats'
import { segmentVisits, type VisitPoint } from './visits'
import { rangeWindow, fmtDateTime, type TimeRangeKey } from './dates'

export interface AiToolCtx {
  companyId: string
  tz: string
  assets: AssetWithLocation[]
  geofences: Geofence[]
  alerts: AlertEvent[]
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

async function runFleetSnapshot(ctx: AiToolCtx) {
  const { assets, geofences } = ctx
  const rings = geofences
    .filter((g) => g.kind !== 'boundary')
    .map((g) => ({ name: g.name, ring: (g.geometry?.coordinates?.[0] ?? []) as [number, number][] }))
  return assets.map((a) => {
    const loc = a.location
    const site = loc
      ? rings.find((r) => r.ring.length >= 3 && pointInPolygon([loc.lng, loc.lat], r.ring))?.name ?? null
      : null
    const raw = (loc?.raw ?? {}) as Record<string, unknown>
    const fuelPct = typeof raw['fuel.level'] === 'number' ? Math.round(raw['fuel.level'] as number) : null
    const rpm = typeof raw['engine.rpm'] === 'number' ? (raw['engine.rpm'] as number) : null
    return {
      name: a.name,
      type: a.type,
      site: site ?? (loc ? 'off-site' : 'no signal'),
      speedMph: loc?.speed ?? null,
      moving: (loc?.speed ?? 0) > 2,
      batteryPct: loc?.battery ?? null,
      fuelPct,
      engineOn: rpm != null ? rpm > 300 : typeof raw['engine.ignition.status'] === 'boolean' ? raw['engine.ignition.status'] : null,
      lastSeen: loc ? fmtDateTime(new Date(loc.timestamp).getTime(), ctx.tz) : null,
    }
  })
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
  const rows: { lat: number; lng: number; speed: number | null; timestamp: string }[] = []
  while (rows.length < CAP) {
    const { data, error } = await supabase
      .from('asset_locations')
      .select('lat, lng, speed, timestamp')
      .eq('asset_id', asset.id)
      .order('timestamp', { ascending: false })
      .range(rows.length, rows.length + PAGE - 1)
    if (error) return { error: error.message }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  const pts: StatPoint[] = rows
    .reverse()
    .map((r) => ({ lat: r.lat, lng: r.lng, speed: r.speed, ms: Date.parse(r.timestamp) }))
    .filter((p) => Number.isFinite(p.ms))
  const earliestMs = pts.length ? pts[0].ms : null
  const w = rangeWindow(ctx.tz, key, { earliestMs })
  const estMpg = estMpgForSpecs((asset.metadata as Record<string, unknown> | undefined)?.specs)
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

  const { getLocationHistory } = await import('./db/assets')
  const history = await getLocationHistory(ctx.companyId, sinceIso)
  if (!history?.length) return { zone: zone.name, days, visits: [] }

  const ring = (zone.geometry?.coordinates?.[0] ?? []) as [number, number][]
  const visits = segmentVisits(history as VisitPoint[], ring)
  const nameOf = (id: string) => ctx.assets.find((a) => a.id === id)?.name ?? 'Unknown asset'
  return {
    zone: zone.name,
    days,
    visits: visits.slice(0, 40).map((v) => ({
      asset: nameOf(v.assetId),
      arrived: fmtDateTime(v.enterMs, ctx.tz),
      left: v.exitMs ? fmtDateTime(v.exitMs, ctx.tz) : 'still on site',
      minutes: v.minutes,
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
    reportedAt: fmtDateTime(new Date(loc.timestamp).getTime(), ctx.tz),
    speedMph: loc.speed,
    batteryPct: loc.battery,
    params,
    note: 'Odometer values are meters; fuel.level is percent of tank; battery.voltage is the 12V system.',
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

/** Execute one tool call. Never throws — errors return as {error} so the
 *  model can recover ("no such asset — here's the list"). */
export async function runAiTool(name: string, input: Record<string, unknown>, ctx: AiToolCtx): Promise<unknown> {
  try {
    switch (name) {
      case 'fleet_snapshot': return await runFleetSnapshot(ctx)
      case 'asset_activity': return await runAssetActivity(ctx, input as { asset_name?: string; range?: string })
      case 'asset_telemetry': return await runAssetTelemetry(ctx, input as { asset_name?: string })
      case 'site_visits': return await runSiteVisits(ctx, input as { zone_name?: string; days?: number })
      case 'recent_alerts': return await runRecentAlerts(ctx, input as { limit?: number })
      default: return { error: `Unknown tool ${name}` }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'tool failed' }
  }
}
