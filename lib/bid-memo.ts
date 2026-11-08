/**
 * The bid memo (migration 146; Brian, Nov 7: "Ideally ai does the takeoff and
 * completes all of the typical stuff. Provides a writeup with risk
 * assessment, questions, assumptions, etc.").
 *
 * Facts first, then words: the memo is written ONLY from what the plan room
 * and the takeoff hold — the sets and their dates, every sheet's revision and
 * scale status, the quantities, the marks still waiting for a look, the
 * sheets nobody placed. The model drafts; an estimator edits and approves.
 * No prices ever go in (the memo is readable by everyone who can open the
 * plan room). Without a key, a plain memo is built from the same facts.
 */
import { everydayModel } from './ai-status'
import { buildTakeoff } from './takeoff-summary'
import { currentOf, revLabel, setKindLabel } from './plans/room'
import { versionFromRow } from './db/plans'
import { checksFor } from './plans/measure'
import { scaleVerdict } from './plans/scale'
import type { Corners4 } from './plans/north'

type Db = ReturnType<typeof import('./supabase-server')['createServiceClient']>

export interface BidFacts {
  site: string
  sets: { name: string; kind: string; issued: string }[]
  sheets: { number: string; title: string | null; rev: string; issued: string; scale: string; placed: boolean; marks: number }[]
  quantities: { code: string; item: string; unit: string; qty: number; withWaste: number; section: string | null; toCheck: number; suggested: number }[]
  marksToCheck: number
  marksSuggested: number
  /** The dirt takeoff's numbers, when the site has one. */
  dirt: { name: string; cutCy: number | null; fillCy: number | null; topsoilCy: number | null; exportCy: number | null; importCy: number | null; shrinkPct: number | null } | null
}

/** Everything the memo may say, from the database, pinned to the company. */
export async function gatherBidFacts(db: Db, companyId: string, zoneId: string): Promise<BidFacts | null> {
  const t = await buildTakeoff(db, companyId, zoneId, false)
  if (!t) return null
  const [{ data: sets }, { data: sheets }] = await Promise.all([
    db.from('plan_sets').select('name, kind, issued_on').eq('geofence_id', zoneId).eq('company_id', companyId).is('deleted_at', null).order('issued_on', { ascending: false }).limit(50),
    db.from('plan_sheets').select('id, number, title, current_version_id').eq('geofence_id', zoneId).eq('company_id', companyId).is('deleted_at', null).is('voided_at', null).limit(500),
  ])
  const ids = (sheets ?? []).map((s) => String(s.id))
  const { data: vers } = ids.length
    ? await db.from('plan_versions').select('id, sheet_id, image_id, rev, issued_on, created_at, page_w, feet_per_inch, scale_text, scale_checks, placement').in('sheet_id', ids).eq('company_id', companyId).is('deleted_at', null).limit(5000)
    : { data: [] as Record<string, unknown>[] }
  const imgIds = (vers ?? []).map((v) => v.image_id).filter((x): x is string => !!x)
  const { data: imgs } = imgIds.length ? await db.from('zone_imagery').select('id, bounds').in('id', imgIds) : { data: [] as Record<string, unknown>[] }
  const boundsOf = new Map((imgs ?? []).map((i) => [String(i.id), (Array.isArray(i.bounds) && i.bounds.length === 4 ? i.bounds : null) as Corners4 | null]))
  const marksOf = new Map(t.sheets.map((s) => [s.sheetId, s.marks]))
  const sheetFacts = (sheets ?? []).flatMap((s) => {
    const vs = (vers ?? []).filter((v) => v.sheet_id === s.id).map((v) => ({ row: v, v: versionFromRow(v as Record<string, unknown>) }))
    const cur = currentOf({ pinnedVersionId: (s.current_version_id as string | null) ?? null }, vs.map((x) => x.v))
    if (!cur) return []
    const row = vs.find((x) => x.v.id === cur.id)!.row
    const bounds = cur.imageId ? boundsOf.get(cur.imageId) ?? null : null
    const v = { ...cur, scaleChecks: Array.isArray(row.scale_checks) ? row.scale_checks as { key: string; feetPerInch: number; detail: string }[] : null }
    return [{
      number: String(s.number), title: (s.title as string | null) ?? null, rev: revLabel(cur.rev), issued: cur.issuedOn,
      scale: scaleVerdict(checksFor(v, bounds)).words, placed: !!bounds, marks: marksOf.get(String(s.id)) ?? 0,
    }]
  }).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
  let dirt: BidFacts['dirt'] = null
  try {
    const { data: d } = await db.from('dirt_takeoffs').select('name, results').eq('geofence_id', zoneId).eq('company_id', companyId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    // The saved run's own numbers (lib/dirt/takeoff.ts DirtResults).
    const r = (d?.results ?? null) as Record<string, unknown> | null
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null)
    if (d && r) {
      dirt = {
        name: String(d.name ?? 'Dirt takeoff'), cutCy: n(r.cutCy), fillCy: n(r.fillCy),
        topsoilCy: n((r.topsoil as { cy?: unknown } | null)?.cy), exportCy: n(r.exportCy), importCy: n(r.importCy),
        shrinkPct: typeof r.shrinkPct === 'number' && Number.isFinite(r.shrinkPct) ? r.shrinkPct : null,
      }
    }
  } catch { /* no dirt takeoff on this site */ }
  return {
    site: t.zoneName,
    sets: (sets ?? []).map((s) => ({ name: String(s.name), kind: setKindLabel(String(s.kind)), issued: String(s.issued_on) })),
    sheets: sheetFacts,
    quantities: t.rows.map((r) => ({ code: r.code, item: r.name, unit: r.unit, qty: r.qty, withWaste: r.qtyWithWaste, section: r.section, toCheck: r.check, suggested: r.suggested })),
    marksToCheck: t.check, marksSuggested: t.suggested, dirt,
  }
}

const SYSTEM = `You draft the bid memo a sitework estimator sends with a bid (grading, paving, storm, utilities, concrete). Write plain text with these five headings in capitals, each followed by short dash bullets:
SCOPE AND QUANTITIES — what the takeoff covers, by section, with the quantities and units given (use "with waste" figures where given).
ASSUMPTIONS — what the numbers assume (the plan revisions and dates used, the scales, items not yet measured, the dirt figures if given).
RISKS — what could move the number: sheets with scale warnings, sheets not placed, marks still waiting for a look or suggested by the first pass, missing sheets for scopes that have quantities (and the reverse), revisions issued late. Where a risk moves a quantity, say low / expected / high in words, only from the figures given.
QUESTIONS FOR THE GC — RFIs to send, each a concrete question tied to a sheet number.
EXCLUSIONS AND QUALIFICATIONS — standard sitework exclusions that fit what is NOT in the takeoff (rock, unsuitable soils, dewatering, permits and fees, testing, bonds) — phrased as "Excludes …" / "Assumes …".
Use ONLY the facts given. Never invent quantities, prices, dates, sheet numbers or company names. No prices at all. No preamble, no sign-off, under 450 words.`

/** The model's draft, or null (no key, refusal, cut short, error). */
async function compose(f: BidFacts): Promise<{ body: string; model: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })
    const model = everydayModel()
    const res = await client.messages.create({
      model, max_tokens: 6000, system: SYSTEM,
      messages: [{ role: 'user', content: `FACTS: ${JSON.stringify(f)}` }],
    })
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null
    const body = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim()
    return body ? { body: body.slice(0, 40000), model } : null
  } catch (err) {
    console.error('Bid memo compose failed', err)
    return null
  }
}

/** The memo without a model: the same five headings, straight from the facts. */
export function plainBidMemo(f: BidFacts): string {
  const L: string[] = []
  L.push('SCOPE AND QUANTITIES')
  const bySec = new Map<string, BidFacts['quantities']>()
  for (const q of f.quantities) { const k = q.section ?? 'Other'; if (!bySec.has(k)) bySec.set(k, []); bySec.get(k)!.push(q) }
  if (!f.quantities.length) L.push('- Nothing measured yet.')
  bySec.forEach((qs, sec) => { L.push(`- ${sec}: ${qs.map((q) => `${q.item} ${fmt(q.withWaste)} ${q.unit}`).join('; ')}`) })
  if (f.dirt) {
    const net = f.dirt.exportCy ? `export ${fmtN(f.dirt.exportCy)} CY` : f.dirt.importCy ? `import ${fmtN(f.dirt.importCy)} CY` : 'balanced on site'
    L.push(`- Earthwork (${f.dirt.name}): cut ${fmtN(f.dirt.cutCy)} CY, fill ${fmtN(f.dirt.fillCy)} CY, topsoil ${fmtN(f.dirt.topsoilCy)} CY, ${net}${f.dirt.shrinkPct !== null ? ` at ${f.dirt.shrinkPct}% shrink` : ''}.`)
  }
  L.push('', 'ASSUMPTIONS')
  for (const s of f.sets.slice(0, 5)) L.push(`- Plans: ${s.name} (${s.kind}, issued ${s.issued}).`)
  for (const s of f.sheets) L.push(`- ${s.number} ${s.rev} (${s.issued}): ${s.scale}`)
  L.push('', 'RISKS')
  const risks: string[] = []
  for (const s of f.sheets) {
    if (/disagree|half-size|double-size|No scale/i.test(s.scale)) risks.push(`- ${s.number}: ${s.scale}`)
    if (!s.placed) risks.push(`- ${s.number} is not placed on the map — its location is unchecked against the site.`)
  }
  if (f.marksToCheck) risks.push(`- ${f.marksToCheck} mark${f.marksToCheck === 1 ? '' : 's'} carried onto a revised drawing still need a look.`)
  if (f.marksSuggested) risks.push(`- ${f.marksSuggested} suggested mark${f.marksSuggested === 1 ? '' : 's'} from the first pass not yet accepted.`)
  L.push(...(risks.length ? risks : ['- None found in the plan room.']))
  L.push('', 'QUESTIONS FOR THE GC', '- (Add the RFIs for this bid.)')
  L.push('', 'EXCLUSIONS AND QUALIFICATIONS', '- Excludes rock excavation, unsuitable soils and dewatering unless listed above.', '- Excludes permits, fees, testing and bonds.')
  return L.join('\n')
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 100) / 100))
const fmtN = (v: number | null) => (v === null ? '?' : v.toLocaleString('en-US'))

/** Draft the memo: the model when it answers, the plain memo when it doesn't. */
export async function draftBidMemo(f: BidFacts, useAi: boolean): Promise<{ body: string; model: string | null }> {
  const ai = useAi ? await compose(f) : null
  return ai ?? { body: plainBidMemo(f), model: null }
}
