/**
 * Where a company's SAVED aircraft are right now — one upstream call for the
 * whole watchlist, so a saved plane can be drawn wherever it is flying, not
 * only inside the 250 nm the map's own poll covers (Brian, Sep 21: "save
 * planes as a user then those planes be red or blinking or something when
 * active").
 *
 * adsb.lol answers `/v2/hex/<a>,<b>,…` with the current state of every
 * airframe in the list that is transmitting (verified with two live airframes
 * over Atlanta the day this shipped). Cached per watchlist for a few seconds
 * so every viewer of one company shares one call, served stale for a while
 * when the feed is down, and a 429 earns the same cooldown /api/planes keeps —
 * this is the same free community feed, and hammering it is what earns the
 * next one.
 */

export interface LiveState {
  hex: string
  flight: string | null
  reg: string | null
  type: string | null
  lat: number
  lon: number
  altFt: number
  /** The feed's own flag, never an altitude threshold (see /api/planes). */
  onGround: boolean
  gsKt: number | null
  vsFpm: number | null
  track: number | null
  /** Seconds since the feed last saw a position for this aircraft. */
  seenPos: number | null
}

export interface LiveAnswer { at: number; planes: Map<string, LiveState> }

interface AdsbAc {
  hex?: string; flight?: string; r?: string; t?: string
  lat?: number; lon?: number; alt_baro?: number | string; alt_geom?: number
  gs?: number; baro_rate?: number; geom_rate?: number; track?: number; seen_pos?: number
}

/** One aircraft as the feed reports it, or null when it has no position. */
export function normalizeAc(a: AdsbAc): LiveState | null {
  if (typeof a.lat !== 'number' || typeof a.lon !== 'number' || !a.hex) return null
  const alt = typeof a.alt_baro === 'number' ? a.alt_baro : typeof a.alt_geom === 'number' ? a.alt_geom : null
  const onGround = a.alt_baro === 'ground'
  if (!onGround && alt == null) return null
  return {
    hex: a.hex.toLowerCase(),
    flight: a.flight?.trim() || null,
    reg: a.r?.trim() || null,
    type: a.t?.trim() || null,
    lat: a.lat,
    lon: a.lon,
    altFt: onGround ? 0 : Math.round(alt as number),
    onGround,
    gsKt: typeof a.gs === 'number' ? Math.round(a.gs) : null,
    vsFpm: typeof a.baro_rate === 'number' ? Math.round(a.baro_rate)
      : typeof a.geom_rate === 'number' ? Math.round(a.geom_rate) : null,
    track: typeof a.track === 'number' ? Math.round(a.track) : null,
    seenPos: typeof a.seen_pos === 'number' && a.seen_pos >= 0 ? Math.min(60, a.seen_pos) : null,
  }
}

const cache = new Map<string, LiveAnswer>()
const inflight = new Map<string, Promise<LiveAnswer>>()
const TTL_MS = 10_000
/** Past this a position is fiction; the caller gets nothing rather than a ghost. */
const STALE_MS = 90_000
let cooldownUntil = 0
const COOLDOWN_MS = 20_000
/** A company may watch 25 aircraft (MAX_SAVED in lib/actions/aircraft.ts). */
const MAX_HEXES = 25

async function fetchStates(key: string): Promise<LiveAnswer> {
  const resp = await fetch(`https://api.adsb.lol/v2/hex/${key}`, {
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
    headers: { 'User-Agent': 'HammerTrack fleet map (hammertrack.ai)' },
  })
  if (resp.status === 429) cooldownUntil = Date.now() + COOLDOWN_MS
  if (!resp.ok) throw new Error(`feed ${resp.status}`)
  cooldownUntil = 0
  const j: { ac?: AdsbAc[] } = await resp.json()
  const planes = new Map<string, LiveState>()
  for (const a of j.ac ?? []) {
    const p = normalizeAc(a)
    if (p) planes.set(p.hex, p)
  }
  return { at: Date.now(), planes }
}

/**
 * Current state of each of these airframes that is transmitting. Returns
 * null when the feed cannot answer and nothing usable is cached — the caller
 * keeps what it had; a saved plane missing from the answer is simply not
 * transmitting (parked with its avionics off, or out of every receiver's
 * reach), which is the honest reading.
 */
export async function liveStates(hexes: string[]): Promise<LiveAnswer | null> {
  const list = Array.from(new Set(hexes.map((h) => String(h).trim().toLowerCase()).filter((h) => /^[0-9a-f]{6}$/.test(h)))).sort().slice(0, MAX_HEXES)
  if (!list.length) return { at: Date.now(), planes: new Map() }
  const key = list.join(',')
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < TTL_MS) return hit
  const standIn = hit && now - hit.at < STALE_MS ? hit : null
  if (now < cooldownUntil) return standIn
  let job = inflight.get(key)
  if (!job) {
    const started = fetchStates(key)
    job = started
    inflight.set(key, started)
    started.catch(() => {}).finally(() => { if (inflight.get(key) === started) inflight.delete(key) })
  }
  try {
    const ans = await job
    if (cache.size > 200) cache.clear()
    const held = cache.get(key)
    if (!held || held.at < ans.at) cache.set(key, ans)
    return ans
  } catch (e) {
    console.warn('[aircraft-live] upstream failed:', e instanceof Error ? e.message : e)
    return standIn
  }
}
