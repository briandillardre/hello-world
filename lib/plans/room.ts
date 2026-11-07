/**
 * The plan room's rules — pure (migration 143; Brian, Nov 7: "needs to be
 * obvious which are most recent").
 *
 *   CURRENT     the version someone pinned, else the newest one issued
 *               (issued date, then upload time)
 *   SUPERSEDED  every older version, with the date and what replaced it
 *   HELD        newer than a pinned older version — a revision somebody has
 *               decided not to build from yet
 *   NEW         a version uploaded by someone else that you have not opened
 *
 * The page, the review screen, the viewer and the map all read these, so
 * "current" means one thing everywhere.
 */

export interface RoomVersion {
  id: string
  sheetId: string
  setId: string | null
  fileId: string | null
  imageId: string | null
  page: number | null
  rev: string | null
  issuedOn: string
  createdAt: string
  createdBy: string | null
  signature: string | null
  pageW: number | null
  pageH: number | null
  inkBox: number[] | null
  feetPerInch: number | null
  scaleText: string | null
  placement: { source?: string; check?: boolean; from?: string; errorFt?: number; n?: number; what?: string; assumedUp?: boolean } | null
  crop: { x0: number; y0: number; x1: number; y1: number; on?: boolean } | null
  /** The page's own scale evidence read at upload (lib/plans/scale.ts). */
  scaleChecks?: { key: string; feetPerInch: number; detail: string }[] | null
}

export interface RoomSheet {
  id: string
  number: string
  numberKey: string
  title: string | null
  discipline: string | null
  pinnedVersionId: string | null
  voidedAt: string | null
  createdAt: string
}

export interface RoomSet {
  id: string
  name: string
  kind: PlanSetKind
  issuedOn: string
  createdAt: string
}

export type PlanSetKind = 'bid' | 'addendum' | 'ifc' | 'revision' | 'record' | 'other'

export const SET_KINDS: { key: PlanSetKind; label: string; hint: string }[] = [
  { key: 'bid', label: 'Bid set', hint: 'The drawings you price' },
  { key: 'addendum', label: 'Addendum', hint: 'Only the sheets that changed' },
  { key: 'revision', label: 'Revision', hint: 'A re-issue of the whole set' },
  { key: 'ifc', label: 'Issued for construction', hint: 'The set you build from' },
  { key: 'record', label: 'Record / as-built', hint: 'What was actually built' },
  { key: 'other', label: 'Other', hint: 'Anything else' },
]

export const setKindLabel = (k: string): string => SET_KINDS.find((s) => s.key === k)?.label ?? 'Set'

/** A full re-issue (not an addendum) is expected to carry every sheet, so a
 *  sheet it leaves out is asked about ("C-104 isn't in this set. Void it?"). */
export const isFullIssue = (k: PlanSetKind): boolean => k === 'bid' || k === 'revision' || k === 'ifc' || k === 'record'

/** Newest first: issued date, then upload time, then id (stable). */
export function newestFirst(a: Pick<RoomVersion, 'issuedOn' | 'createdAt' | 'id'>, b: Pick<RoomVersion, 'issuedOn' | 'createdAt' | 'id'>): number {
  return b.issuedOn.localeCompare(a.issuedOn) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

/** The sheet's current version: the pin when it is still live, else the newest. */
export function currentOf(sheet: Pick<RoomSheet, 'pinnedVersionId'>, versions: RoomVersion[]): RoomVersion | null {
  if (!versions.length) return null
  if (sheet.pinnedVersionId) {
    const pinned = versions.find((v) => v.id === sheet.pinnedVersionId)
    if (pinned) return pinned
  }
  return [...versions].sort(newestFirst)[0]
}

export type VersionStatus =
  | { kind: 'current'; pinned: boolean }
  | { kind: 'superseded'; by: RoomVersion }
  | { kind: 'held'; current: RoomVersion }

/** Where one version stands among its sheet's versions. */
export function statusOf(v: RoomVersion, sheet: Pick<RoomSheet, 'pinnedVersionId'>, versions: RoomVersion[]): VersionStatus {
  const cur = currentOf(sheet, versions)
  if (!cur || cur.id === v.id) return { kind: 'current', pinned: !!sheet.pinnedVersionId && cur?.id === sheet.pinnedVersionId }
  const sorted = [...versions].sort(newestFirst)
  const iv = sorted.findIndex((x) => x.id === v.id)
  const ic = sorted.findIndex((x) => x.id === cur.id)
  if (iv < ic) return { kind: 'held', current: cur }
  // Replaced by the next one up the list (toward the current).
  return { kind: 'superseded', by: sorted[iv - 1] ?? cur }
}

/** The version that was current on a given day (yyyy-mm-dd) — the map's
 *  timeline. A pin is today's decision, so history ignores it: on Aug 20 the
 *  sheet looked the way the newest version issued by Aug 20 drew it. null
 *  before the first version was issued. */
export function currentOn(day: string, versions: RoomVersion[]): RoomVersion | null {
  return [...versions].filter((v) => v.issuedOn <= day).sort(newestFirst)[0] ?? null
}

/**
 * NEW for this person: the current version came from somebody else's upload
 * in the plan room and they have not opened it since. Versions adopted from
 * before the plan room (no uploader) are never new — 13 old sheets lighting
 * up at once would teach everyone to ignore the dot.
 */
export function isNewFor(me: string | null, current: RoomVersion | null, seenVersionId: string | null | undefined): boolean {
  if (!current || !me || !current.createdBy || current.createdBy === me) return false
  return seenVersionId !== current.id
}

/** "Rev 2" / "Rev B" / "No rev" — the one way a revision is written. */
export function revLabel(rev: string | null | undefined): string {
  const r = (rev ?? '').trim()
  return r ? `Rev ${r}` : 'No rev'
}

// ── Sheet order ─────────────────────────────────────────────────────────────

const DISCIPLINES: Record<string, string> = {
  G: 'General', GN: 'General', GI: 'General', T: 'Title', V: 'Survey', B: 'Geotechnical',
  D: 'Demolition', DM: 'Demolition', DEMO: 'Demolition', EX: 'Existing conditions',
  C: 'Civil', CS: 'Civil', CG: 'Civil · grading', CU: 'Civil · utilities', CD: 'Civil · details', CE: 'Civil · erosion control',
  GR: 'Grading', U: 'Utilities', UT: 'Utilities', SW: 'Stormwater', W: 'Water',
  EC: 'Erosion control', ES: 'Erosion control', ESC: 'Erosion control',
  SP: 'Site plan', PR: 'Paving', PL: 'Planting', PH: 'Photometric', LT: 'Lighting',
  L: 'Landscape', LP: 'Landscape', LA: 'Landscape',
  A: 'Architectural', AS: 'Architectural', S: 'Structural', ST: 'Structural',
  M: 'Mechanical', E: 'Electrical', P: 'Plumbing',
}
// The order a civil set is bound in.
const DISCIPLINE_ORDER = ['General', 'Title', 'Survey', 'Existing conditions', 'Demolition', 'Site plan', 'Civil',
  'Civil · grading', 'Grading', 'Civil · utilities', 'Utilities', 'Stormwater', 'Water', 'Paving',
  'Civil · erosion control', 'Erosion control', 'Civil · details', 'Landscape', 'Planting', 'Lighting', 'Photometric',
  'Geotechnical', 'Architectural', 'Structural', 'Mechanical', 'Plumbing', 'Electrical']

/** The letters a sheet number starts with: "C-101" → "C", "CG3.0" → "CG". */
export function disciplineOf(number: string): string | null {
  const m = /^([A-Za-z]{1,4})(?=[-.\s]?\d)/.exec(number.trim())
  return m ? m[1].toUpperCase() : null
}

/** The heading a sheet files under. Placeholder P-sheets and unknown letters
 *  share one "Other sheets" group at the end. */
export function disciplineName(discipline: string | null | undefined, number?: string): string {
  const d = (discipline ?? (number ? disciplineOf(number) : null) ?? '').toUpperCase()
  if (!d || (d === 'P' && number && /^P-\d+$/.test(number))) return 'Other sheets'
  return DISCIPLINES[d] ?? 'Other sheets'
}

const groupRank = (g: string) => {
  const i = DISCIPLINE_ORDER.indexOf(g)
  return i < 0 ? DISCIPLINE_ORDER.length + (g === 'Other sheets' ? 1 : 0) : i
}

/** Natural order: C-2 before C-10, C1.0 before C1.1 before C2.0. */
export function compareSheetNumbers(a: string, b: string): number {
  const ta = a.toUpperCase().match(/[A-Z]+|\d+/g) ?? []
  const tb = b.toUpperCase().match(/[A-Z]+|\d+/g) ?? []
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i], y = tb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y)
    if (nx && ny) { const d = Number(x) - Number(y); if (d) return d }
    else if (x !== y) return nx ? -1 : ny ? 1 : x.localeCompare(y)
  }
  return a.localeCompare(b)
}

/** Sheets grouped by discipline in binding order, numbers in natural order. */
export function groupSheets<T extends Pick<RoomSheet, 'number' | 'discipline'>>(sheets: T[]): { name: string; sheets: T[] }[] {
  const groups = new Map<string, T[]>()
  for (const s of sheets) {
    const g = disciplineName(s.discipline, s.number)
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(s)
  }
  return Array.from(groups.entries())
    .sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([name, xs]) => ({ name, sheets: xs.sort((p: T, q: T) => compareSheetNumbers(p.number, q.number)) }))
}

// ── The review screen ───────────────────────────────────────────────────────

/** "C-101", "c 101" and "C101" are one sheet. Mirrors title-block.ts. */
export const numberKey = (number: string): string => number.toUpperCase().replace(/[\s-]+/g, '')

/** A sheet number the database will take: 1–24 characters, letters, digits,
 *  dash, dot, space. */
export function cleanNumber(s: string): string | null {
  const t = s.trim().replace(/\s+/g, ' ').toUpperCase()
  if (!t || t.length > 24 || !/^[A-Z0-9][A-Z0-9 .\-/]*$/.test(t)) return null
  return numberKey(t) ? t : null
}

export type PageVerdict =
  | { kind: 'new' }
  | { kind: 'revises'; sheetId: string; from: RoomVersion }
  | { kind: 'unchanged'; sheetId: string; same: RoomVersion }
  | { kind: 'older'; sheetId: string; current: RoomVersion }
  | { kind: 'not-sheet' }

/**
 * What one page of an upload does to the plan room:
 *   new        — no sheet with that number yet
 *   revises    — replaces the current version
 *   unchanged  — the drawing matches the current version (only the title
 *                block differs), so it is skipped unless the person keeps it
 *   older      — issued BEFORE the current version: it files into the history
 *                behind it instead of taking over
 *   not-sheet  — no number (a cover or notes page); keep it by typing one
 */
export function verdictFor(
  page: { number: string | null; signature: string | null },
  issuedOn: string,
  sheets: Pick<RoomSheet, 'id' | 'numberKey' | 'pinnedVersionId'>[],
  versionsBySheet: Map<string, RoomVersion[]>,
): PageVerdict {
  const num = page.number ? cleanNumber(page.number) : null
  if (!num) return { kind: 'not-sheet' }
  const sheet = sheets.find((s) => s.numberKey === numberKey(num))
  if (!sheet) return { kind: 'new' }
  const versions = versionsBySheet.get(sheet.id) ?? []
  const cur = currentOf(sheet, versions)
  if (!cur) return { kind: 'new' }
  // The same drawing we already have: the current one, a revision held back
  // behind a pin, or the very version this set's date already filed (the same
  // set uploaded twice). A match to an OLDER revision under a new date is a
  // revert — a real revision, kept.
  if (page.signature) {
    const same = versions.filter((v) => v.signature === page.signature)
    const hit = same.find((v) => v.id === cur.id) ??
      same.find((v) => statusOf(v, sheet, versions).kind === 'held') ??
      same.find((v) => v.issuedOn === issuedOn)
    if (hit) return { kind: 'unchanged', sheetId: sheet.id, same: hit }
  }
  if (issuedOn < cur.issuedOn) return { kind: 'older', sheetId: sheet.id, current: cur }
  return { kind: 'revises', sheetId: sheet.id, from: cur }
}

/** A revision mark one past the current one ("0" → "1", "B" → "C"), for a
 *  revised page whose title block reads no rev. null when there is no clear
 *  next mark. */
export function nextRev(rev: string | null | undefined): string | null {
  const r = (rev ?? '').trim().toUpperCase()
  if (!r) return '1'
  if (/^\d+$/.test(r)) return String(Number(r) + 1)
  if (/^[A-Y]$/.test(r)) return String.fromCharCode(r.charCodeAt(0) + 1)
  return null
}

/** The issue date most of a set's pages print (ties → the newest), else null.
 *  Pre-fills the set's date on the review screen. */
export function commonDate(dates: (string | null)[]): string | null {
  const n = new Map<string, number>()
  for (const d of dates) if (d) n.set(d, (n.get(d) ?? 0) + 1)
  let best: string | null = null, bestN = 0
  for (const [d, c] of Array.from(n)) if (c > bestN || (c === bestN && best !== null && d > best)) { best = d; bestN = c }
  return best
}

/** How a version got onto the map, in words (the evidence travels with it). */
export function placementWords(p: RoomVersion['placement'], placed: boolean): string {
  if (!placed) return 'Not on the map yet'
  switch (p?.source) {
    case 'grid': return `Placed from its state plane ${p.what ?? 'grid ticks'} · worst ${p.errorFt ?? '?'} ft${p.assumedUp ? ' · grid north assumed up' : ''}`
    case 'carried': return p.check ? 'Placed where the last version sat — the drawing moved on the paper, check it' : 'Placed where the last version sat (same plot)'
    case 'manual': return 'Placed by hand'
    default: return 'Placed'
  }
}
