/**
 * Two guards on the tracker stream, run by the flespi ingest (Sep 28 2026).
 * Pure — no database here; app/api/ingest/flespi/route.ts holds the state
 * and migration 124 stores what has to outlive one webhook batch.
 * Harness: `node scripts/ingest-guard-test.mjs` — run it after ANY change.
 *
 * 1. GPS SPIKES. The Charleston dump trailer's battery unit sent one fix the
 *    device itself called valid (4 satellites) from the Gulf of Mexico,
 *    6,000 mph out from Charleston and 6,000 mph back — the map drew a line
 *    to the Gulf and the day read 1,357.8 miles. A fix that implies more
 *    than 300 mph over more than 20 km from the last one is not a place the
 *    machine went; it is logged, not stored. A second fix that agrees with
 *    it proves the move was real (a tracker moved to another machine, a long
 *    offline stretch) and both go in — one fix is the most a guard can cost.
 *
 * 2. PARKED TAG CHATTER. A truck parked near tagged gear sends a "tag scan"
 *    record every ~11 s all day and night — the OBD unit's Bluetooth scan
 *    writes one on every change in what it hears, and a tag at the edge of
 *    range flickers in and out. On Sep 28 that was 45% of every truck
 *    message: 2,503 of the F650's 2,517 were tag scans while it never moved.
 *    Each carries the parked position again and nothing else. The ingest
 *    now keeps the first and last of every parked run, one at least every
 *    2.5 minutes, and any that hears a tag the run hadn't heard; the rest
 *    still feed tool custody but are not stored as positions.
 *
 *    Why that is safe for hours and idle math: every other fix in the
 *    stream (engine, moving, a new place) keeps its true neighbour on both
 *    sides — the run's first record is kept, and its last one is held and
 *    stored the moment the run ends. Inside a run all records are the same:
 *    parked, same spot, no engine signal. So every "time since the last
 *    fix" the ledger, trips, scorecards and idle math add up covers the
 *    same span as before, only in fewer, still-short pieces — kept under
 *    the 3-minute idle cadence in lib/asset-stats (IDLE_CADENCE_MS).
 */

export interface GuardFix {
  ms: number
  lat: number
  lng: number
  /** mph, as stored */
  speed: number | null
}

const R_KM = 6371.0088

export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Straight-line speed between two fixes, mph. A zero gap counts as one second. */
export function impliedMph(a: GuardFix, b: GuardFix): number {
  const hours = Math.max(1, Math.abs(b.ms - a.ms) / 1000) / 3600
  return (kmBetween(a, b) * 0.621371) / hours
}

// ── 1. GPS spikes ───────────────────────────────────────────────────────────

export const JUMP_MIN_KM = 20
export const JUMP_MAX_MPH = 300
/** Past this much silence a far fix is a machine that moved while dark. */
export const JUMP_WINDOW_MS = 2 * 3_600_000
/** A second fix this soon after a rejected one, agreeing with it, confirms it. */
export const CONFIRM_WINDOW_MS = 30 * 60_000
export const CONFIRM_MAX_MPH = 150

export type JumpVerdict = 'ok' | 'reject' | 'confirmed'

/**
 * `prev` is the newest fix the asset has (stored or held); `lastReject` the
 * newest fix this guard turned away. 'confirmed' = store the earlier reject
 * too, then this one.
 */
export function jumpVerdict(prev: GuardFix | null, fix: GuardFix, lastReject: GuardFix | null): JumpVerdict {
  if (!prev || fix.ms <= prev.ms || fix.ms - prev.ms > JUMP_WINDOW_MS) return 'ok'
  if (kmBetween(prev, fix) <= JUMP_MIN_KM || impliedMph(prev, fix) <= JUMP_MAX_MPH) return 'ok'
  if (
    lastReject && lastReject.ms < fix.ms && fix.ms - lastReject.ms <= CONFIRM_WINDOW_MS &&
    (kmBetween(lastReject, fix) <= JUMP_MIN_KM || impliedMph(lastReject, fix) <= CONFIRM_MAX_MPH)
  ) return 'confirmed'
  return 'reject'
}

/** One line for the log row and the server log. */
export function jumpReason(prev: GuardFix, fix: GuardFix): string {
  return `jump ${Math.round(kmBetween(prev, fix))} km in ${Math.max(1, Math.round((fix.ms - prev.ms) / 1000))} s ` +
    `(${Math.round(impliedMph(prev, fix)).toLocaleString('en-US')} mph)`
}

// ── 2. Parked tag chatter ───────────────────────────────────────────────────

/** Teltonika's tag-scan event (AVL 385, "Beacon"), as flespi's event.enum. */
export const TAG_SCAN_EVENT = 385
/** Longest gap left between stored fixes inside a parked run — under the
 *  3-minute idle cadence (lib/asset-stats IDLE_CADENCE_MS) with room for a
 *  late record. */
export const MAX_PIECE_MS = 150_000
/** A parked unit repeats its last position; GNSS jitter stays well inside this. */
export const SAME_PLACE_M = 25

/** The only keys a tag-scan record carries besides its tag list: transport
 *  bookkeeping. A record with ANY other key (ignition, voltage, a CAN
 *  reading) is not chatter and is always stored. */
const PLUMBING = new Set([
  'source', 'peer', 'server.timestamp', 'channel.id', 'protocol.id', 'codec.id',
  'device.name', 'device.type.id',
  'event.enum', 'event.priority.enum', 'position.satellites', 'ble.beacons',
])

export function isTagChatter(params: Record<string, unknown> | null | undefined, speed: number | null | undefined): boolean {
  if (!params || Number(params['event.enum']) !== TAG_SCAN_EVENT) return false
  if ((speed ?? 0) !== 0) return false
  for (const k of Object.keys(params)) if (!PLUMBING.has(k)) return false
  return true
}

/** Tag ids in a record's list, upper-cased — how the run tells a new tag. */
export function tagIdsOf(params: Record<string, unknown> | null | undefined): string[] {
  const list = params?.['ble.beacons']
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const b of list) {
    const id = b && typeof b === 'object' ? (b as { id?: unknown; mac?: unknown }).id ?? (b as { mac?: unknown }).mac : null
    if (typeof id === 'string' && id) out.push(id.toUpperCase())
  }
  return out
}

export interface ChatterFix extends GuardFix {
  chatter: boolean
  tags: string[]
}

/** Per asset: the newest STORED fix, the newest held (skipped) one, and the
 *  tags the current run has already stored. Survives a batch as `last` (the
 *  asset's newest row) + `tail` and its `run_tags` (asset_fix_tail). */
export interface ChatterState<T extends ChatterFix = ChatterFix> {
  last: ChatterFix | null
  tail: T | null
  runTags: Set<string>
}

export function chatterState<T extends ChatterFix>(last: ChatterFix | null, tail: T | null, runTags: string[] = []): ChatterState<T> {
  const live = tail && last && tail.ms > last.ms ? tail : null
  // A held record means the run is still going: what it had stored so far
  // carries over. Without one the run starts again at `last`.
  return { last, tail: live, runTags: new Set([...(last?.chatter ? last.tags : []), ...(live ? runTags : [])]) }
}

/** The newest fix the asset has, stored or held — a new fix's predecessor. */
export function newestFix(s: ChatterState<ChatterFix>): ChatterFix | null {
  return s.tail ?? s.last
}

function sameSpot(a: GuardFix, b: GuardFix): boolean {
  return kmBetween(a, b) * 1000 <= SAME_PLACE_M
}

/**
 * Decide one fix, in arrival order; updates `s`. `store` = write it;
 * `flush` = write this held fix FIRST (it is the one right before `f`).
 */
export function chatterStep<T extends ChatterFix>(s: ChatterState<T>, f: T): { store: boolean; flush: T | null } {
  const newest = newestFix(s)
  if (!newest) {
    s.last = f
    s.runTags = new Set(f.chatter ? f.tags : [])
    return { store: true, flush: null }
  }
  // A late record (buffered offline, a retried batch): store it, touch
  // nothing. The SAME second is not late — an engine record stamped the
  // second a scan was held must still end the run, or the scans after it
  // lose their place and its time goes to the wrong column.
  if (f.ms < newest.ms) return { store: true, flush: null }

  const last = s.last!
  const held = s.tail
  const inRun = f.chatter && newest.chatter && sameSpot(newest, f) && sameSpot(last, f)
  if (!inRun) {
    // The run ended (or there was none): its last record goes in first, so
    // whatever follows keeps its true predecessor.
    s.last = f
    s.tail = null
    s.runTags = new Set(f.chatter ? f.tags : [])
    return { store: true, flush: held }
  }

  let flush: T | null = null
  if (held && f.ms - last.ms > MAX_PIECE_MS) {
    // Storing `f` would leave too long a gap: the held record goes in first.
    flush = held
    s.last = held
    s.tail = null
    for (const t of held.tags) s.runTags.add(t)
  }
  const newTag = f.tags.some((t) => !s.runTags.has(t))
  if (!newTag && f.ms - s.last!.ms <= MAX_PIECE_MS) {
    s.tail = f
    return { store: false, flush }
  }
  s.last = f
  s.tail = null
  for (const t of f.tags) s.runTags.add(t)
  return { store: true, flush }
}
