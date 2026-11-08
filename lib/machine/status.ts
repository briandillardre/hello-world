/**
 * Machine files by revision (migration 149) — pure. A machine file remembers
 * the plan versions it was built from; this says whether those are still the
 * current ones, in words: "C-101: built from Rev 1 — Rev 2 is current (issued
 * 2026-11-03)". A file of the same name and kind filed later is the newer one.
 */
import { currentOf, newestFirst, revLabel, type RoomSheet, type RoomVersion } from '../plans/room'

export interface BuiltFrom { sheetId: string; versionId: string }

export interface SheetNow extends Pick<RoomSheet, 'id' | 'number' | 'pinnedVersionId' | 'voidedAt'> {
  versions: Pick<RoomVersion, 'id' | 'rev' | 'issuedOn' | 'createdAt'>[]
}

export interface FileStatus {
  state: 'current' | 'behind' | 'unknown'
  /** One line per sheet that moved (behind), or the sheets it matches (current). */
  lines: string[]
}

export const MACHINE_KINDS = ['tp3', 'tn3', 'svd', 'svl', 'ttm', 'vcl', 'dxf', 'landxml', 'dwg', 'pdf', 'zip', 'other'] as const
export type MachineKind = typeof MACHINE_KINDS[number]

export const KIND_WORDS: Record<MachineKind, string> = {
  tp3: 'Topcon TP3', tn3: 'Topcon TN3', svd: 'Trimble SVD', svl: 'Trimble SVL', ttm: 'Trimble TTM', vcl: 'Trimble VCL',
  dxf: 'DXF', landxml: 'LandXML', dwg: 'DWG', pdf: 'PDF', zip: 'Zip', other: 'File',
}

/** The kind a file name says it is. */
export function kindOf(filename: string): MachineKind {
  const ext = (filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '')
  if (ext === 'xml') return 'landxml'
  return (MACHINE_KINDS as readonly string[]).includes(ext) ? (ext as MachineKind) : 'other'
}

/** Clean what a client sends as built_from: well-formed ids only, no repeats, at most 200. */
export function cleanBuiltFrom(v: unknown): BuiltFrom[] {
  if (!Array.isArray(v)) return []
  const id = /^[0-9a-f-]{36}$/i
  const seen = new Set<string>()
  const out: BuiltFrom[] = []
  for (const b of v) {
    const s = b && typeof b === 'object' ? (b as Record<string, unknown>) : null
    if (!s || typeof s.sheetId !== 'string' || typeof s.versionId !== 'string' || !id.test(s.sheetId) || !id.test(s.versionId) || seen.has(s.sheetId)) continue
    seen.add(s.sheetId)
    out.push({ sheetId: s.sheetId, versionId: s.versionId })
    if (out.length >= 200) break
  }
  return out
}

/** Where a machine file stands against the plan room today. */
export function fileStatus(builtFrom: BuiltFrom[], sheets: Map<string, SheetNow>): FileStatus {
  if (!builtFrom.length) return { state: 'unknown', lines: ['Which plan revisions it was built from isn’t recorded.'] }
  const behind: string[] = [], matches: string[] = []
  for (const b of builtFrom) {
    const s = sheets.get(b.sheetId)
    if (!s) { behind.push('A sheet it was built from has been deleted from the plan room.'); continue }
    if (s.voidedAt) { behind.push(`${s.number} has been voided since.`); continue }
    const cur = currentOf({ pinnedVersionId: s.pinnedVersionId }, s.versions as RoomVersion[])
    const mine = s.versions.find((v) => v.id === b.versionId)
    if (!cur) { behind.push(`${s.number} has no version left in the plan room.`); continue }
    if (cur.id === b.versionId) { matches.push(`${s.number} ${revLabel(cur.rev)}`); continue }
    if (!mine) { behind.push(`${s.number}: the version it was built from was removed — ${revLabel(cur.rev)} (issued ${cur.issuedOn}) is current.`); continue }
    // newestFirst(cur, mine) < 0: the file's version sorts after the current one — it is older.
    const mineIsOlder = newestFirst(cur as RoomVersion, mine as RoomVersion) < 0
    behind.push(mineIsOlder
      ? `${s.number}: built from ${revLabel(mine.rev)} — ${revLabel(cur.rev)} is current (issued ${cur.issuedOn}).`
      : `${s.number}: built from ${revLabel(mine.rev)}, but ${revLabel(cur.rev)} is pinned as current.`)
  }
  if (behind.length) return { state: 'behind', lines: behind }
  return { state: 'current', lines: [`Matches the current plans: ${matches.join(', ')}.`] }
}

/** Newest first; within a name and kind, everything after the first is an older copy. */
export function markOlder<T extends { id: string; name: string; kind: string; createdAt: string }>(files: T[]): (T & { older: boolean })[] {
  const sorted = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  const seen = new Set<string>()
  return sorted.map((f) => {
    const k = `${f.name.trim().toLowerCase()}|${f.kind}`
    const older = seen.has(k)
    seen.add(k)
    return { ...f, older }
  })
}
