/**
 * Grounded fleet Q&A engine.
 *
 * Answers operational questions ("who's at the shop", "what equipment is at
 * Maple St", "labor hours at Riverfront today") by COMPUTING from live data —
 * never by guessing. The API route optionally passes these facts to Claude for
 * nicer phrasing, but the numbers always come from here.
 */
import type { AssetWithLocation, AssetType, Geofence, AlertEvent } from './types'
import { pointInPolygon, unreadActionableCount } from './alerts-engine'
import { type Project, periodCost, moneyFull, WORKDAY_HOURS, LIVE_DAY_FRACTION } from './projects'
import { insightQuestion, type InsightRow } from './insights'

const insightQuestionFor = (i: { detector: string; evidence: Record<string, unknown> }) =>
  insightQuestion(i as Pick<InsightRow, 'detector' | 'evidence'>)

export interface AssistantContext {
  assets: AssetWithLocation[]
  geofences: Geofence[]
  projects: Project[]
  alerts: AlertEvent[]
  /** Insight-engine findings (already role-filtered by the caller) — powers
   *  "what should I look at" and the tap-to-ask chips on the grounded path. */
  insights?: { detector: string; headline: string; detail: string | null; evidence: Record<string, unknown> }[]
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

/** Words a question carries that never name a machine. */
const ASK_STOP = new Set(['where', 'wheres', 'where\'s', 'is', 'are', 'was', 'the', 'my', 'our', 'a', 'an', 'at', 'to', 'of', 'on', 'in',
  'locate', 'find', 'show', 'me', 'what', 'whats', 'right', 'now', 'currently', 'it', 'this', 'that', 'and', 'for', 'do', 'does', 'did',
  'today', 'tonight', 'please', 'hey', 'yo', 'can', 'you', 'tell', 'about', 'with', 'go', 'went', 'go'])
const tokens = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export interface AssetPick { asset: AssetWithLocation | null; ambiguous: AssetWithLocation[] }

/**
 * Which machine is the question about? The whole name in the question wins
 * (longest first, so "truck 4" never matches every truck). Failing that,
 * the WORDS: "chevy 1500" finds "Chevy 1500 - Brian", "vw" finds the VW —
 * people never type the full name the office gave a truck (Brian, Sep 23:
 * "Where is chevy 1500" answered with a fleet summary while the AI service
 * was down). A tie ("where is the truck") is returned as ambiguous so the
 * answer can ask which one instead of guessing.
 */
export function resolveAssetPick(ql: string, assets: AssetWithLocation[]): AssetPick {
  let best: AssetWithLocation | null = null
  for (const a of assets) {
    if (ql.includes(a.name.toLowerCase()) && (!best || a.name.length > best.name.length)) best = a
  }
  if (best) return { asset: best, ambiguous: [] }
  const q = tokens(ql).filter((t) => !ASK_STOP.has(t))
  if (!q.length) return { asset: null, ambiguous: [] }
  let top = 0
  let picks: AssetWithLocation[] = []
  for (const a of assets) {
    const n = tokens(a.name)
    const score = q.filter((t) => n.some((w) => w === t || (t.length >= 3 && w.startsWith(t)))).length
    if (!score) continue
    if (score > top) { top = score; picks = [a] }
    else if (score === top) picks.push(a)
  }
  if (picks.length === 1) return { asset: picks[0], ambiguous: [] }
  return { asset: null, ambiguous: picks }
}

/** "4 min ago" / "3 h ago" / "2 d ago" for a fix timestamp. */
function agoWords(iso: string | undefined, nowMs = Date.now()): string | null {
  if (!iso) return null
  const ms = nowMs - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return null
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** One sentence on where a machine is, from its newest fix. */
function whereIs(asset: AssetWithLocation, geofences: Geofence[]): AssistantAnswer {
  const site = siteOf(asset, geofences)
  if (!asset.location) {
    return { answer: `${asset.name} has never reported a location.`, facts: { asset: asset.name, site: null } }
  }
  const speed = Math.round(asset.location.speed ?? 0)
  const moving = speed > 0
  const place = site ? `at ${site.name}` : 'off-site'
  const ago = agoWords(asset.location.timestamp)
  const state = moving ? `moving at ${speed} mph` : 'parked'
  return {
    answer: `${asset.name} is ${place}, ${state}${ago ? ` — last reported ${ago}` : ''}.`,
    facts: { asset: asset.name, site: site?.name ?? null, moving, speedMph: speed, lastReport: asset.location.timestamp, lat: asset.location.lat, lng: asset.location.lng },
  }
}

function whichOne(list: AssetWithLocation[]): AssistantAnswer {
  return {
    answer: `Which one do you mean — ${names(list)}?`,
    facts: { candidates: list.slice(0, 8).map((a) => a.name) },
  }
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

  // ── Insight engine: tap-to-ask chips + "what should I look at" ──
  if (ctx.insights?.length) {
    // A chip question matches its own insight exactly — answer with the
    // finding's evidence, never a generic shrug.
    const asked = ctx.insights.find((i) => insightQuestionFor(i).toLowerCase() === ql)
    if (asked) {
      return {
        answer: `${asked.headline}.${asked.detail ? ` ${asked.detail}` : ''}`,
        facts: { detector: asked.detector, ...asked.evidence },
      }
    }
    // Guarded on !fence so "what's the problem at Creekside?" still routes
    // to the site intents instead of the fleet-wide overview.
    if (!fence && /(worth a look|should i (look|know|worry|watch)|anything i should|what should i be|how are we doing|any (problem|issue|trend)|insight)/.test(ql)) {
      const top = ctx.insights.slice(0, 3)
      return {
        answer: `Worth a look right now: ${top.map((i) => i.headline).join(' · ')}. Tap any card on the map's Today panel to dig in.`,
        facts: { findings: top.map((i) => i.headline) },
      }
    }
  }

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
  if (/(where('?s| is|s\b)|locate|find)/.test(ql)) {
    const pick = resolveAssetPick(ql, assets)
    if (pick.asset) return whereIs(pick.asset, geofences)
    if (pick.ambiguous.length) return whichOne(pick.ambiguous)
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
  const pick = resolveAssetPick(ql, assets)
  if (pick.asset) {
    const w = whereIs(pick.asset, geofences)
    return { ...w, answer: `${pick.asset.name} (${TYPE_LABEL[pick.asset.type]}): ${w.answer.slice(pick.asset.name.length + 1)}` }
  }
  if (pick.ambiguous.length) return whichOne(pick.ambiguous)

  // ── Fleet summary ──
  const online = assets.filter((a) => a.location).length
  // Same rule as the nav bell — zone-log crossings aren't "active alerts".
  const openAlerts = unreadActionableCount(alerts)
  return {
    answer: `${online} of ${assets.length} assets are online across ${geofences.length} sites${openAlerts ? `, with ${openAlerts} active alert${openAlerts > 1 ? 's' : ''}` : ''}. Ask me who's at a site, what's on it, labor hours, or today's cost.`,
    facts: { online, total: assets.length, sites: geofences.length, openAlerts },
  }
}

// Account-agnostic on purpose: these render on REAL accounts too, and the
// old demo-zone phrasings ("Who's at Riverfront Tower?") dead-ended for
// every actual customer (live check, Aug 27).
export const SUGGESTED_QUESTIONS = [
  "Who's on site right now?",
  "What's costing me money?",
  'Any theft alerts?',
  'What did the trucks do today?',
]
