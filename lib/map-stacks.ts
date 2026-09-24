/**
 * Stacks on the map — what a count circle means and what tapping it does.
 *
 * Brian, Sep 24, of the F350 and its dump trailer drawn as ONE puck with two
 * names at 3 mi, and only coming apart at 20 ft: "Assets stacked on top of
 * each other or in roughly the same location need to be shown with a blank
 * circle with the # of assets. This would change as you zoom out … the
 * entire upstate would probably be one circle with the # of assets in it.
 * When the number circle is clicked on, think through best in class ui ux
 * interface for how to then zoom in or show what devices are within that
 * close region."
 *
 * The circle: every marker source clusters (live dots AND the trail heads
 * his map actually shows — trails are on by default, and the heads never
 * clustered, which is why the F350 sat on top of its trailer), all the way
 * to street zoom, so two things that would overlap are always one count.
 *
 * The tap, decided by how far apart the members really are:
 *   • spread out (a yard, a site, a county) → glide to fit exactly those
 *     members — they split into their own pucks or smaller counts — and a
 *     "N here · List" chip offers the list without another tap on the map;
 *   • stacked (within ~40 m: a truck and the trailer it tows, a crew phone
 *     in the cab) → zooming can't separate them, so the circle opens in
 *     place: the members fan out on short legs (a pair above and below it,
 *     three or more in a column beside it), the circle turns into a close
 *     button, a tap on any member opens it;
 *   • a big stack at one spot (a yard with 20 machines parked nose to tail)
 *     → the list, because a fan of twenty is noise.
 *
 * Pure module: MapView owns the map calls. Harness:
 * `node scripts/map-stacks-test.mjs` — run it after ANY change here.
 */

/** Cluster radius for every marker source, in screen px (a puck is ~22 px). */
export const STACK_RADIUS_PX = 40
/** Things this close stay one count at every zoom — through the map's last
 *  step (22, MapLibre's default maxZoom), where 40 px is about a metre… */
export const STACK_MAX_ZOOM = 22
/** …which needs the GeoJSON source to tile one step past it. */
export const STACK_SOURCE_MAXZOOM = 23
/** Members closer than this can't be told apart by zooming — fan them. */
export const FAN_SPREAD_M = 40
/** A stack bigger than this at one spot gets the list, not a fan (a column
 *  of eight is ~300 px — about what a phone has between the bars). */
export const FAN_MAX = 8

export interface StackPoint { id: string; lng: number; lat: number }

export type StackMove =
  | { kind: 'fit'; bounds: [[number, number], [number, number]]; spanM: number }
  | { kind: 'fan'; spanM: number }
  | { kind: 'list'; spanM: number }

function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

const finite = (p: StackPoint) => Number.isFinite(p.lng) && Number.isFinite(p.lat)

/** [[west, south], [east, north]] around the points. */
export function boundsOf(pts: StackPoint[]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const p of pts) {
    if (!finite(p)) continue
    if (p.lng < w) w = p.lng
    if (p.lng > e) e = p.lng
    if (p.lat < s) s = p.lat
    if (p.lat > n) n = p.lat
  }
  return [[w, s], [e, n]]
}

/** How far apart the members really are: the diagonal of their box. */
export function spanMetres(pts: StackPoint[]): number {
  const ok = pts.filter(finite)
  if (ok.length < 2) return 0
  const [[w, s], [e, n]] = boundsOf(ok)
  return metres({ lng: w, lat: s }, { lng: e, lat: n })
}

/** The middle of the members — where the circle is drawn (the cluster's own
 *  point is the mean of its members, so this lands on it). */
export function centroidOf(pts: StackPoint[]): [number, number] | null {
  const ok = pts.filter(finite)
  if (!ok.length) return null
  return [ok.reduce((a, p) => a + p.lng, 0) / ok.length, ok.reduce((a, p) => a + p.lat, 0) / ok.length]
}

/** What a tap on this stack should do. */
export function stackMove(pts: StackPoint[]): StackMove {
  const spanM = spanMetres(pts)
  if (spanM > FAN_SPREAD_M) return { kind: 'fit', bounds: boundsOf(pts), spanM }
  return pts.length > FAN_MAX ? { kind: 'list', spanM } : { kind: 'fan', spanM }
}

/** How far a pair opens above and below the circle, px. */
export const FAN_PAIR_R = 46
/** A column of three or more sits this far beside the circle… */
export const FAN_COL_X = 68
/** …one row per member, this far apart (a two-line name is 28 px). */
export const FAN_ROW_H = 38
/** Names wrap past this width (the layer's text-max-width: 11 ems × 11 px). */
export const FAN_NAME_W = 121

export type FanAnchor = 'left' | 'right' | 'top' | 'bottom'
export interface FanSlot { x: number; y: number; anchor: FanAnchor }

/**
 * Where each member sits when a stack opens, in screen px from the circle
 * (y grows downward), and which way its name hangs (a MapLibre text-anchor:
 * 'left' puts the text to the puck's right).
 *   • two → one above and one below, names above and below them: a pair
 *     reads top to bottom, and a phone is taller than it is wide (side by
 *     side, a truck and its trailer with their names were ~400 px across);
 *   • three or more → a short column beside the circle, names outward — a
 *     list pinned to the spot (a ring of names collides with itself).
 * `side` is which side the column goes: +1 right, −1 left.
 */
export function fanLayout(n: number, side: 1 | -1 = 1): FanSlot[] {
  if (n <= 0) return []
  if (n === 1) return [{ x: 0, y: -FAN_PAIR_R, anchor: 'bottom' }]
  if (n === 2) return [{ x: 0, y: -FAN_PAIR_R, anchor: 'bottom' }, { x: 0, y: FAN_PAIR_R, anchor: 'top' }]
  return Array.from({ length: n }, (_, i) => ({
    x: side * FAN_COL_X,
    y: Math.round((i - (n - 1) / 2) * FAN_ROW_H),
    anchor: side > 0 ? 'left' : 'right',
  }))
}

/** A name's rough size at the fan's 11 px bold: ~6.5 px a character,
 *  wrapping to a second line past FAN_NAME_W. */
export function nameBox(name: string): { w: number; h: number } {
  const w = Math.ceil(6.5 * name.length)
  return w > FAN_NAME_W ? { w: FAN_NAME_W, h: 28 } : { w, h: 14 }
}

export interface ScreenBox { minX: number; maxX: number; minY: number; maxY: number }

/** The screen box an open fan covers around its circle, in px: the circle,
 *  every puck, and each name where it hangs. */
export function fanExtent(names: string[], side: 1 | -1 = 1): ScreenBox {
  let minX = -28, maxX = 28, minY = -28, maxY = 28 // the circle itself
  fanLayout(names.length, side).forEach((o, i) => {
    const b = nameBox(names[i] ?? '')
    let x0 = o.x - 13, x1 = o.x + 13, y0 = o.y - 13, y1 = o.y + 13
    if (o.anchor === 'left') { x1 = o.x + 15 + b.w; y0 = Math.min(y0, o.y - b.h / 2); y1 = Math.max(y1, o.y + b.h / 2) }
    else if (o.anchor === 'right') { x0 = o.x - 15 - b.w; y0 = Math.min(y0, o.y - b.h / 2); y1 = Math.max(y1, o.y + b.h / 2) }
    else {
      x0 = Math.min(x0, o.x - b.w / 2)
      x1 = Math.max(x1, o.x + b.w / 2)
      if (o.anchor === 'top') y1 = o.y + 15 + b.h
      else y0 = o.y - 15 - b.h
    }
    minX = Math.min(minX, x0); maxX = Math.max(maxX, x1)
    minY = Math.min(minY, y0); maxY = Math.max(maxY, y1)
  })
  return { minX, maxX, minY, maxY }
}

/** How far to pan (px, in MapLibre's panBy sense: +x moves the picture
 *  left) so a box lands inside the clear part of the screen; a box too big
 *  for it is centred. [0, 0] when it already fits. */
export function nudgeInto(box: ScreenBox, safe: { left: number; right: number; top: number; bottom: number }): [number, number] {
  const axis = (lo: number, hi: number, a: number, b: number) =>
    hi - lo > b - a ? (lo + hi) / 2 - (a + b) / 2 : lo < a ? lo - a : hi > b ? hi - b : 0
  // Whole px, rounded AWAY from zero so the box always ends up inside.
  const px = (v: number) => (v > 0 ? Math.ceil(v) : v < 0 ? Math.floor(v) : 0)
  return [px(axis(box.minX, box.maxX, safe.left, safe.right)), px(axis(box.minY, box.maxY, safe.top, safe.bottom))]
}

/** How many metres the stack radius covers at a zoom and latitude: what
 *  "close enough to be one count" means on screen right now (at z17 about
 *  20 m, at z18 about 10 m). MapLibre tiles are 512 px. */
export function stackRadiusMetres(zoom: number, lat: number): number {
  const mPerPx = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
  return STACK_RADIUS_PX * mPerPx
}

/**
 * Is a fanned-out stack still one stack at the zoom it opened at? It folds
 * back when its members have spread past what counts as one stack there
 * (`joinM`, from stackRadiusMetres — a truck that pulled 15 m off its trailer
 * at z18 is its own puck again, and a fan still drawing it would draw it
 * twice), or when someone new has come within that reach. `nearAtOpen`: ids
 * that were already that close when it opened — a machine parked 25 m away
 * at z17 never was in the count, so it never "joins" (ship-check, Sep 24:
 * the fan snapped shut on the next live tick).
 */
export function fanStillHolds(members: StackPoint[], others: StackPoint[], joinM: number = FAN_SPREAD_M * 2, nearAtOpen?: Set<string>): boolean {
  const ok = members.filter(finite)
  if (ok.length < 2 || spanMetres(ok) > joinM) return false
  const c = centroidOf(ok)
  if (!c) return false
  const hub = { lng: c[0], lat: c[1] }
  return !others.some((o) => finite(o) && !nearAtOpen?.has(o.id) && metres(hub, o) <= joinM)
}

/** The ids already within `joinM` of a stack's middle as it opens. */
export function nearbyIds(members: StackPoint[], others: StackPoint[], joinM: number): Set<string> {
  const c = centroidOf(members)
  const out = new Set<string>()
  if (!c) return out
  const hub = { lng: c[0], lat: c[1] }
  for (const o of others) if (finite(o) && metres(hub, o) <= joinM) out.add(o.id)
  return out
}
