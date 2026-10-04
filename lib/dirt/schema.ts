/**
 * What a saved takeoff design may contain — checked on the server before any
 * write (lib/actions/dirt.ts) and by the editor before it sends. Unknown keys
 * are dropped; numbers must be finite and in range; sizes are capped so one
 * takeoff can't become a multi-megabyte row.
 */
import { z } from 'zod'
import { DIRT_KINDS, type DirtDesign } from './takeoff'

export const MAX_FEATURES = 3000
export const MAX_POINTS_PER_FEATURE = 6000
export const MAX_POINTS_TOTAL = 80000
/** Everything traced must fit in a box this many degrees across (~5 km). */
export const MAX_SPAN_DEG = 0.05

const lngLat = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
])

const feature = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  kind: z.enum(DIRT_KINDS as [string, ...string[]]),
  label: z.string().max(60).optional(),
  z: z.number().finite().min(-1500).max(30000).optional(),
  offsetIn: z.number().finite().min(-120).max(120).optional(),
  thicknessIn: z.number().finite().min(0).max(240).optional(),
  coords: z.array(lngLat).min(1).max(MAX_POINTS_PER_FEATURE),
  src: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
}).strip()

export const designSchema = z.object({
  v: z.literal(1),
  features: z.array(feature).max(MAX_FEATURES),
  existing: z.object({
    source: z.enum(['lidar', 'traced']),
    offsetFt: z.number().finite().min(-30000).max(30000),
  }).strip(),
  settings: z.object({
    shrinkPct: z.number().finite().min(0).max(60),
    truckCy: z.number().finite().min(1).max(40),
  }).strip(),
  sheets: z.array(z.string().uuid()).max(20).optional(),
}).strip()

export type DesignCheck = { ok: true; design: DirtDesign } | { ok: false; error: string }

/** Validate an untrusted design; on success the returned copy is the one to store. */
export function checkDesign(input: unknown): DesignCheck {
  const r = designSchema.safeParse(input)
  if (!r.success) {
    const i = r.error.issues[0]
    return { ok: false, error: `That takeoff doesn't look right (${i?.path.join('.') || 'design'}: ${i?.message ?? 'invalid'}).` }
  }
  const total = r.data.features.reduce((s, f) => s + f.coords.length, 0)
  if (total > MAX_POINTS_TOTAL) return { ok: false, error: `That takeoff has ${total.toLocaleString()} traced points — the limit is ${MAX_POINTS_TOTAL.toLocaleString()}.` }
  // One site, not a county: everything traced must sit inside ~5 km.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const f of r.data.features) for (const [lng, lat] of f.coords) {
    if (lng < x0) x0 = lng
    if (lng > x1) x1 = lng
    if (lat < y0) y0 = lat
    if (lat > y1) y1 = lat
  }
  if (x1 - x0 > MAX_SPAN_DEG || y1 - y0 > MAX_SPAN_DEG) return { ok: false, error: 'Your traces spread over more than about 5 km — a takeoff covers one site. Split it into separate takeoffs.' }
  const ids = new Set<string>()
  for (const f of r.data.features) {
    if (ids.has(f.id)) return { ok: false, error: 'Two traced features share an id — reload and try again.' }
    ids.add(f.id)
    const need = f.kind === 'eg_spot' || f.kind === 'fg_spot' ? 1 : f.kind.endsWith('contour') ? 2 : 3
    if (f.coords.length < need) return { ok: false, error: `A ${f.kind.replace('_', ' ')} needs at least ${need} point${need === 1 ? '' : 's'}.` }
  }
  return { ok: true, design: r.data as DirtDesign }
}
