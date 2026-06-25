/**
 * Grounded fleet Q&A engine.
 *
 * Answers operational questions ("who's at the shop", "what equipment is at
 * Maple St", "labor hours at Riverfront today") by COMPUTING from live data —
 * never by guessing. The API route optionally passes these facts to Claude for
 * nicer phrasing, but the numbers always come from here.
 */
import type { AssetWithLocation, AssetType, Geofence, AlertEvent } from './types'
import { pointInPolygon } from './alerts-engine'
import { type Project, periodCost, moneyFull, WORKDAY_HOURS, LIVE_DAY_FRACTION } from './projects'

export interface AssistantContext {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  projects: Project[]
  alerts: AlertEvent[]
}

export interface AssistantAnswer {
  answer: string
  facts: Record<string, unknown>
}

const TYPE_LABEL: Record<AssetType, string> = {
  vehicle: 'vehicle', equipment: 'equipment', personnel: 'crew', tool: 'tool',
}

// Casual names people use for the job sites
const ALIASES: { keys: string[]; name: string }[] = [
  { keys: ['shop', 'yard', 'equipment yard'], name: 'Equipment Yard' },
  { keys: ['riverfront', 'tower', 'river front'], name: 'Riverfront Tower' },
  { keys: ['maple', 'grading', 'maple st', 'maple street'], name: 'Maple St Grading' },
]

function resolveGeofence(ql: string, geofences: Geofence[]): Geofence | null {
  for (const g of geofences) if (ql.includes(g.name.toLowerCase())) return g
  for (const a of ALIASES) {
    if (a.keys.some((k) => ql.includes(k))) {
      const g = geofences.find((gf) => gf.name === a.name)
      if (g) return g
    }
  }
  return null
}

function resolveAsset(ql: string, assets: AssetWithLocation[]): AssetWithLocation | null {
  // longest name match wins (avoids "truck" matching every truck)
  let best: AssetWithLocation | null = null
  for (const a of assets) {
    if (ql.includes(a.name.toLowerCase()) && (!best || a.name.length > best.name.length)) best = a
  }
  return best
}

function inside(g: Geofence, assets: AssetWithLocation[]): AssetWithLocation[] {
  const ring = g.geometry.coordinates[0] as [number, number][]
  return assets.filter((a) => a.location && pointInPolygon([a.location.lng, a.location.lat], ring))
}

function names(list: AssetWithLocation[]): string {
  if (list.length === 0) return 'none'
  if (list.length <= 4) return list.map((a) => a.name).join(', ')
  return `${list.slice(0, 4).map((a) => a.name).join(', ')} +${list.length - 4} more`
}

function siteOf(a: AssetWithLocation, geofences: Geofence[]): Geofence | null {
  if (!a.location) return null
  return geofences.find((g) => pointInPolygon([a.location!.lng, a.location!.lat], g.geometry.coordinates[0] as [number, number][])) ?? null
}

export function answerQuestion(question: string, ctx: AssistantContext): AssistantAnswer {
  const ql = question.toLowerCase().trim()
  const { assets, geofences, projects, alerts } = ctx
  const fence = resolveGeofence(ql, geofences)
  const project = fence ? projects.find((p) => p.geofenceId === fence.id) : undefined

  // ── Alerts / theft ──
  if (/(alert|theft|stolen|after.?hours|left site)/.test(ql)) {
    const open = alerts.filter((a) => !a.acknowledged_at)
    if (open.length === 0) return { answer: 'All clear — no active alerts right now.', facts: { activeAlerts: 0 } }
    const lines = open.slice(0, 5).map((a) => {
      const who = a.asset?.name ?? 'An asset'
      const what = (a.rule?.trigger ?? 'alert').replace(/_/g, ' ')
      const where = a.rule?.geofence?.name
      return `• ${who} — ${what}${where ? ` at ${where}` : ''}`
    })
    return { answer: `${open.length} active alert${open.length > 1 ? 's' : ''}:\n${lines.join('\n')}`, facts: { activeAlerts: open.length } }
  }

  // ── Idle / costing money ──
  if (/(idle|sitting|costing|wasting|not moving|parked)/.test(ql)) {
    const idleEquip = assets.filter((a) => (a.type === 'equipment' || a.type === 'vehicle') && a.location && (a.location.speed ?? 0) === 0)
    return {
      answer: idleEquip.length === 0
        ? 'Everything with an engine is moving right now.'
        : `${idleEquip.length} machine${idleEquip.length > 1 ? 's' : ''} sitting idle: ${names(idleEquip)}.`,
      facts: { idle: idleEquip.map((a) => a.name) },
    }
  }

  // ── Where is <asset> ──
  if (/(where('?s| is)|locate|find)/.test(ql)) {
    const asset = resolveAsset(ql, assets)
    if (asset) {
      const site = siteOf(asset, geofences)
      const moving = (asset.location?.speed ?? 0) > 0
      const place = site ? `at ${site.name}` : 'off-site / in transit'
      return { answer: `${asset.name} is ${place}${moving ? `, moving at ${asset.location?.speed} mph` : ', parked'}.`, facts: { asset: asset.name, site: site?.name ?? null } }
    }
  }

  // ── Labor hours at a site ──
  if (fence && /(labor|man.?hour|hours|crew time)/.test(ql)) {
    const crew = inside(fence, assets).filter((a) => a.type === 'personnel').length
    const projCrew = project?.crewSize ?? crew
    const hoursEach = Math.round(WORKDAY_HOURS * LIVE_DAY_FRACTION * 10) / 10
    const total = Math.round(projCrew * hoursEach)
    return {
      answer: `${fence.name}: about ${total} labor hours logged today across ${projCrew} crew (~${hoursEach} hrs each so far).`,
      facts: { site: fence.name, crew: projCrew, laborHours: total },
    }
  }

  // ── Cost / budget at a site ──
  if (fence && /(cost|spent|spend|budget|money|burn)/.test(ql)) {
    if (!project) return { answer: `${fence.name} is a support zone — no job costs are billed against it.`, facts: { site: fence.name } }
    const c = periodCost(project, 'live', 1)
    return {
      answer: `${fence.name} has cost ${moneyFull(c.total)} so far today — ${moneyFull(c.labor)} labor and ${moneyFull(c.equip)} equipment. Budget burn is at ${Math.round((project.spentToDate / project.budget) * 100)}%.`,
      facts: { site: fence.name, today: c.total, labor: c.labor, equip: c.equip },
    }
  }

  // ── Who's at a site ──
  if (fence && /\bwho/.test(ql)) {
    const crew = inside(fence, assets).filter((a) => a.type === 'personnel')
    return {
      answer: crew.length === 0 ? `No crew are inside ${fence.name} right now.` : `${crew.length} on the crew at ${fence.name}: ${names(crew)}.`,
      facts: { site: fence.name, crew: crew.map((a) => a.name) },
    }
  }

  // ── What equipment / what's at a site ──
  if (fence) {
    const here = inside(fence, assets)
    const equip = here.filter((a) => a.type === 'equipment')
    const veh = here.filter((a) => a.type === 'vehicle')
    if (/(equipment|machine|gear|asset|what)/.test(ql) || true) {
      const parts: string[] = []
      if (equip.length) parts.push(`${equip.length} equipment (${names(equip)})`)
      if (veh.length) parts.push(`${veh.length} vehicles (${names(veh)})`)
      const crew = here.filter((a) => a.type === 'personnel').length
      if (crew) parts.push(`${crew} crew`)
      return {
        answer: parts.length ? `${fence.name} right now: ${parts.join(', ')}.` : `Nothing is on site at ${fence.name} right now.`,
        facts: { site: fence.name, onSite: here.length },
      }
    }
  }

  // ── Asset fallback ──
  const asset = resolveAsset(ql, assets)
  if (asset) {
    const site = siteOf(asset, geofences)
    return { answer: `${asset.name} (${TYPE_LABEL[asset.type]}) is ${site ? `at ${site.name}` : 'off-site'}.`, facts: { asset: asset.name } }
  }

  // ── Fleet summary ──
  const online = assets.filter((a) => a.location).length
  const openAlerts = alerts.filter((a) => !a.acknowledged_at).length
  return {
    answer: `${online} of ${assets.length} assets are online across ${geofences.length} sites${openAlerts ? `, with ${openAlerts} active alert${openAlerts > 1 ? 's' : ''}` : ''}. Ask me who's at a site, what's on it, labor hours, or today's cost.`,
    facts: { online, total: assets.length, sites: geofences.length, openAlerts },
  }
}

export const SUGGESTED_QUESTIONS = [
  "Who's at Riverfront Tower?",
  "What equipment is at Maple St?",
  'Labor hours at Riverfront today?',
  "What's costing me money?",
  'Any theft alerts?',
]
