/**
 * Share links (migration 113) — the pure half.
 *
 * Brian, Sep 19: "GIF won't save to phone. Need share option to send link to
 * show certain screen setup to team members either thru app or thru link."
 *
 * One table, two kinds of link, one short URL shape: hammertrack.ai/x/<id>.
 *
 *  • file — a finished export (GIF, PNG, PDF) parked in the private
 *    `exports` bucket. Public BY LINK: a replay GIF is meant to reach a
 *    client or an insurance claim, so the id is the whole secret and the
 *    link dies in 30 days, object included.
 *  • view — "this screen": every layer toggle, the camera, the time range
 *    and playhead, the followed or selected machine, the division filter.
 *    Needs a LOGIN in the same company — it names assets and zones, and the
 *    recipient's own row-level security decides what they see of them.
 *
 * Pure (type imports only) so `node scripts/share-links-test.mjs` can drive
 * the validator: a shared view is applied straight to the map's state, so
 * every field is checked here before it is stored and again when it is read.
 */

import type { MapViewCfg } from './map-views'

export const LINK_ID_LEN = 12
/** Lowercase, no look-alikes (0/o, 1/l/i) — this gets read off a text. */
export const LINK_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const LINK_ID_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/
export const VIEW_LINK_DAYS = 180
export const FILE_LINK_DAYS = 30
/** A cleaned view bigger than this is not a view, it is a payload. */
export const VIEW_JSON_MAX = 6000

/** 12 chars of a 31-letter alphabet ≈ 2^59 — unguessable at any request rate
 *  the /x route will serve. Rejection sampling keeps every letter equally
 *  likely (a plain modulo would favour the first eight). */
export function mintLinkId(random: (n: number) => Uint8Array = defaultRandom): string {
  let out = ''
  while (out.length < LINK_ID_LEN) {
    const bytes = random(LINK_ID_LEN * 2)
    for (let i = 0; i < bytes.length && out.length < LINK_ID_LEN; i++) {
      const b = bytes[i]
      if (b >= 248) continue // 248 = 8 × 31: the tail that would bias the pick
      out += LINK_ALPHABET[b % LINK_ALPHABET.length]
    }
  }
  return out
}

function defaultRandom(n: number): Uint8Array {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }
  if (!g.crypto?.getRandomValues) throw new Error('no secure random source')
  return g.crypto.getRandomValues(new Uint8Array(n))
}

export type SharedRange = 'live' | 'today' | 'yesterday' | '7d' | '30d' | 'ytd' | 'all' | 'custom'
const RANGE_KEYS: readonly SharedRange[] = ['live', 'today', 'yesterday', '7d', '30d', 'ytd', 'all', 'custom']
// Mirrors BasemapId (lib/map-layers) and TrailMode (lib/trails). Kept here as
// plain lists so this module stays import-free for the harness; an id this
// list has never heard of falls back rather than failing the whole link.
const BASE_IDS = ['dark', 'streets', 'terrain', 'satellite', 'hybrid', 'silver', 'plain', 'bw', 'aubergine', 'night', 'vfr', 'ifr']
const TRAIL_MODES = ['off', 'trails', 'heatmap', '3d']
const ID_RE = /^[A-Za-z0-9_:-]{1,80}$/ // uuids, phone-<uid>, zone:<id>, 'none'
const KEY_RE = /^[a-z0-9_-]{1,32}$/

export interface SharedView {
  v: 1
  /** The Layers panel snapshot — same shape a saved view stores. */
  cfg: MapViewCfg
  cam: { lng: number; lat: number; zoom: number; bearing?: number; pitch?: number }
  range: SharedRange
  /** Custom window bounds (epoch ms), only with range 'custom'. */
  from?: number
  to?: number
  /** Playhead 0..1 inside the window, only on a replay range. */
  t?: number
  /** Camera-follow target: an asset id or `zone:<id>`. */
  follow?: string
  /** Open sheets: the selected asset / zone. */
  asset?: string
  zone?: string
  /** Division filter (106): a division id, or 'none' for the unassigned pick. */
  division?: string
  /** Name labels off (the default is on, so only `false` is stored). */
  labels?: boolean
  /** Sunlight (high-contrast) mode on. */
  sun?: boolean
  /** Per-overlay opacity 0..1 where it differs from the default. */
  opacity?: Record<string, number>
}

const str = (v: unknown, max: number, re?: RegExp): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max && (!re || re.test(v)) ? v : null
const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null

/**
 * Validate an incoming view — from the client before it is stored, and from
 * the row before it is applied. Unknown keys are dropped, bad values fall
 * back where a fallback is honest and fail the view where it is not (no
 * camera, no layer config → null).
 */
export function cleanSharedView(input: unknown): SharedView | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  if (!src.cfg || typeof src.cfg !== 'object') return null
  const c = src.cfg as Record<string, unknown>

  const overlays: Record<string, boolean> = {}
  if (c.overlays && typeof c.overlays === 'object') {
    for (const [k, v] of Object.entries(c.overlays as Record<string, unknown>).slice(0, 40)) {
      if (KEY_RE.test(k) && v === true) overlays[k] = true
    }
  }
  const baseIn = str(c.base, 24)
  const trailIn = str(c.trailMode, 16)
  const cfg: MapViewCfg = {
    base: (baseIn && BASE_IDS.includes(baseIn) ? baseIn : 'hybrid') as MapViewCfg['base'],
    threeD: c.threeD === true,
    radar: c.radar === true,
    precip: c.precip === true,
    precipPeriod: str(c.precipPeriod, 16, /^[a-z0-9]+$/) ?? '24h',
    overlays,
    parcels: c.parcels === true,
    trailMode: (trailIn && TRAIL_MODES.includes(trailIn) ? trailIn : 'off') as MapViewCfg['trailMode'],
    zones: c.zones !== false,
  }
  if (c.terrain === true) cfg.terrain = true
  if (c.clouds === true) cfg.clouds = true
  const exag = num(c.terrainExag, 0.5, 5)
  if (exag != null) cfg.terrainExag = Math.round(exag * 100) / 100
  if (c.markers === 'dot' || c.markers === 'arrow') cfg.markers = c.markers

  const camIn = (src.cam && typeof src.cam === 'object' ? src.cam : {}) as Record<string, unknown>
  const lng = num(camIn.lng, -180, 180)
  const lat = num(camIn.lat, -90, 90)
  const zoom = num(camIn.zoom, 0, 24)
  if (lng == null || lat == null || zoom == null) return null
  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d
  const cam: SharedView['cam'] = { lng: round(lng, 6), lat: round(lat, 6), zoom: round(zoom, 2) }
  const bearing = num(camIn.bearing, -360, 360)
  if (bearing) cam.bearing = round(bearing, 1)
  const pitch = num(camIn.pitch, 0, 85)
  if (pitch) cam.pitch = round(pitch, 1)

  const rangeIn = String(src.range ?? 'live') as SharedRange
  const out: SharedView = { v: 1, cfg, cam, range: RANGE_KEYS.includes(rangeIn) ? rangeIn : 'live' }
  if (out.range === 'custom') {
    const from = num(src.from, 0, 4e12)
    const to = num(src.to, 0, 4e12)
    // A custom window with no usable bounds is not a window: the link still
    // opens, on Live, rather than on a replay of nothing.
    if (from == null || to == null || to <= from) out.range = 'live'
    else { out.from = Math.round(from); out.to = Math.round(to) }
  }
  if (out.range !== 'live') {
    const t = num(src.t, 0, 1)
    if (t != null) out.t = round(t, 3)
  }
  for (const k of ['follow', 'asset', 'zone', 'division'] as const) {
    const v = str(src[k], 80, ID_RE)
    if (v) out[k] = v
  }
  if (src.labels === false) out.labels = false
  if (src.sun === true) out.sun = true
  if (src.opacity && typeof src.opacity === 'object') {
    const op: Record<string, number> = {}
    for (const [k, v] of Object.entries(src.opacity as Record<string, unknown>).slice(0, 40)) {
      const n = num(v, 0, 1)
      if (KEY_RE.test(k) && n != null) op[k] = round(n, 2)
    }
    if (Object.keys(op).length) out.opacity = op
  }
  if (JSON.stringify(out).length > VIEW_JSON_MAX) return null
  return out
}

/** A link title somebody would recognise in a push: "Today · Chevy 1500 · Satellite". */
export function defaultViewTitle(parts: { range: string; subject?: string | null; base?: string | null }): string {
  return [parts.range, parts.subject, parts.base].filter((s): s is string => !!s && s.trim().length > 0).join(' · ').slice(0, 80)
}

/** Free-text a person typed, on its way into a push body or a row. */
export function cleanTitle(s: unknown, max = 80): string | null {
  if (typeof s !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/** The in-app path a view link opens. */
export function viewLinkPath(id: string): string {
  return `/map?v=${encodeURIComponent(id)}`
}

/** The public short URL for any link. */
export function shortLinkUrl(domain: string, id: string): string {
  return `https://${domain}/x/${id}`
}

/**
 * An `sms:` URL that opens the Messages app with the text filled in — the
 * door that exists in every WebView when navigator.share does not. iOS reads
 * the body after `&`, Android after `?`; both accept the other's form badly.
 */
export function smsHref(text: string, platform: 'ios' | 'android' | 'web' = 'android'): string {
  const body = encodeURIComponent(text)
  return platform === 'ios' ? `sms:&body=${body}` : `sms:?body=${body}`
}
