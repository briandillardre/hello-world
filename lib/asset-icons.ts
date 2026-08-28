/**
 * Asset map silhouettes — the glyph library behind every dot on the map.
 *
 * One registry serves three doors: MapLibre SDF images (map dots, replay
 * heads, tool dots), the AssetForm picker grid, and any future surface that
 * needs "what does this machine look like". Per-asset choice is stored as
 * `metadata.icon` (same pattern as metadata.color — no schema change);
 * unset falls back to the asset type's default, which keeps every existing
 * fleet rendering exactly as before.
 *
 * DRAWING RULES (learned on the Aug 22 glyphs — see MapView):
 * - 64×64 space, filled WHITE; the map registers them as SDF masks and
 *   tints per-layer, so shape is all that matters here.
 * - Every feature ≥ ~8px in 64-space (strokes, gaps, cutouts). The SDF
 *   threshold erodes thin details at the final ~12px render size — a
 *   clever thin detail becomes a featureless blob on a phone.
 * - Side view, cab/attachment facing RIGHT, ground at y≈52 — one visual
 *   language across the set so mixed fleets read as a family.
 */

import type { AssetType } from './types'

type Draw = (ctx: CanvasRenderingContext2D) => void

export interface AssetIconDef {
  label: string
  group: 'Trucks & road' | 'Dirt & lifting' | 'Ag & grounds' | 'Support' | 'People & tools'
  draw: Draw
}

// roundRect with a plain-rect fallback (older Safari).
const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}
const box = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 3) => {
  ctx.beginPath(); rr(ctx, x, y, w, h, r); ctx.fill()
}
const wheel = (ctx: CanvasRenderingContext2D, x: number, y: number, r = 7) => {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}
const poly = (ctx: CanvasRenderingContext2D, pts: [number, number][]) => {
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath(); ctx.fill()
}
const cut = (ctx: CanvasRenderingContext2D, fn: () => void) => {
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; fn(); ctx.restore()
}

export const ASSET_ICONS: Record<string, AssetIconDef> = {
  /* ── Trucks & road ─────────────────────────────────────────────── */
  pickup: {
    label: 'Pickup', group: 'Trucks & road',
    draw: (ctx) => { // the original Aug 22 vehicle glyph — bed + stepped cab
      ctx.beginPath()
      rr(ctx, 6, 20, 30, 22, 3)
      ctx.moveTo(36, 26); ctx.lineTo(47, 26); ctx.lineTo(56, 35); ctx.lineTo(56, 42); ctx.lineTo(36, 42)
      ctx.closePath(); ctx.fill()
      wheel(ctx, 17, 45); wheel(ctx, 46, 45)
    },
  },
  'service-truck': {
    label: 'Service truck', group: 'Trucks & road',
    draw: (ctx) => { // tall square utility body behind a pickup cab
      box(ctx, 4, 14, 32, 28, 2)
      poly(ctx, [[36, 26], [47, 26], [56, 35], [56, 42], [36, 42]])
      wheel(ctx, 16, 45); wheel(ctx, 46, 45)
      cut(ctx, () => box(ctx, 10, 20, 9, 9, 2)) // compartment door
    },
  },
  flatbed: {
    label: 'Flatbed', group: 'Trucks & road',
    draw: (ctx) => {
      box(ctx, 2, 34, 36, 8, 2)
      poly(ctx, [[38, 24], [48, 24], [56, 33], [56, 42], [38, 42]])
      wheel(ctx, 12, 46, 6.5); wheel(ctx, 25, 46, 6.5); wheel(ctx, 47, 46, 6.5)
    },
  },
  'dump-truck': {
    label: 'Dump truck', group: 'Trucks & road',
    draw: (ctx) => { // box bed with the dump slant on top, taller at the back
      poly(ctx, [[4, 18], [32, 25], [32, 42], [4, 42]])
      poly(ctx, [[35, 26], [46, 26], [56, 35], [56, 42], [35, 42]])
      wheel(ctx, 13, 45); wheel(ctx, 26, 45); wheel(ctx, 46, 45)
    },
  },
  'day-cab': {
    label: 'Day cab (semi)', group: 'Trucks & road',
    draw: (ctx) => { // tall conventional cab + hood, bare frame behind
      box(ctx, 4, 38, 52, 6, 2)
      box(ctx, 28, 12, 18, 30, 3)
      box(ctx, 44, 24, 14, 18, 3)
      wheel(ctx, 13, 46, 6.5); wheel(ctx, 25, 46, 6.5); wheel(ctx, 48, 46, 6.5)
      cut(ctx, () => box(ctx, 32, 17, 10, 9, 2)) // window
    },
  },
  semi: {
    label: 'Semi + trailer', group: 'Trucks & road',
    draw: (ctx) => {
      box(ctx, 2, 14, 36, 26, 2)
      box(ctx, 41, 18, 12, 24, 2)
      box(ctx, 51, 28, 10, 14, 2)
      wheel(ctx, 10, 46, 6); wheel(ctx, 21, 46, 6); wheel(ctx, 45, 46, 6); wheel(ctx, 56, 46, 6)
    },
  },
  'box-truck': {
    label: 'Box truck', group: 'Trucks & road',
    draw: (ctx) => {
      box(ctx, 4, 14, 34, 28, 2)
      poly(ctx, [[40, 26], [49, 26], [56, 33], [56, 42], [40, 42]])
      wheel(ctx, 15, 46); wheel(ctx, 46, 46)
    },
  },
  van: {
    label: 'Van', group: 'Trucks & road',
    draw: (ctx) => { // one-box with a raked windshield
      poly(ctx, [[6, 18], [40, 18], [54, 30], [56, 42], [6, 42]])
      wheel(ctx, 17, 45); wheel(ctx, 45, 45)
      cut(ctx, () => box(ctx, 40, 22, 9, 8, 2)) // windshield
    },
  },
  mixer: {
    label: 'Mixer', group: 'Trucks & road',
    draw: (ctx) => { // tilted drum riding clear of the frame
      ctx.save(); ctx.translate(20, 22); ctx.rotate(-0.18)
      ctx.beginPath(); ctx.ellipse(0, 0, 16, 11, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      box(ctx, 4, 34, 42, 8, 2)
      poly(ctx, [[42, 24], [51, 24], [58, 32], [58, 42], [42, 42]])
      wheel(ctx, 13, 46, 6); wheel(ctx, 27, 46, 6); wheel(ctx, 50, 46, 6)
    },
  },
  'water-truck': {
    label: 'Water truck', group: 'Trucks & road',
    draw: (ctx) => { // rounded tank barrel
      box(ctx, 3, 18, 34, 22, 11)
      poly(ctx, [[38, 26], [48, 26], [56, 34], [56, 42], [38, 42]])
      wheel(ctx, 13, 45, 6.5); wheel(ctx, 26, 45, 6.5); wheel(ctx, 47, 45, 6.5)
    },
  },

  /* ── Dirt & lifting ────────────────────────────────────────────── */
  excavator: {
    label: 'Excavator', group: 'Dirt & lifting',
    draw: (ctx) => { // the original Aug 22 equipment glyph — tracks + boom
      box(ctx, 8, 44, 34, 11, 5.5)
      box(ctx, 12, 26, 20, 16, 3)
      poly(ctx, [[28, 34], [45, 8], [56, 16], [40, 41]])
      poly(ctx, [[47, 12], [61, 22], [49, 31]])
    },
  },
  dozer: {
    label: 'Dozer', group: 'Dirt & lifting',
    draw: (ctx) => { // low tracks + low body + a tall solid blade up front
      box(ctx, 4, 40, 36, 13, 6.5)
      box(ctx, 8, 26, 28, 15, 3)
      box(ctx, 12, 16, 14, 12, 2)
      box(ctx, 36, 31, 10, 8, 2)                                  // push arm
      poly(ctx, [[44, 18], [53, 18], [53, 52], [43, 52], [43, 30]]) // blade
    },
  },
  'skid-steer': {
    label: 'Skid steer', group: 'Dirt & lifting',
    draw: (ctx) => {
      box(ctx, 10, 22, 26, 18, 3)
      poly(ctx, [[32, 24], [48, 30], [48, 42], [40, 42], [32, 34]]) // arm
      poly(ctx, [[44, 32], [60, 32], [58, 46], [44, 46]])            // bucket
      wheel(ctx, 17, 46, 6.5); wheel(ctx, 33, 46, 6.5)
    },
  },
  'wheel-loader': {
    label: 'Wheel loader', group: 'Dirt & lifting',
    draw: (ctx) => {
      box(ctx, 6, 20, 22, 20, 3)
      poly(ctx, [[26, 26], [46, 32], [44, 40], [26, 36]]) // arm
      poly(ctx, [[42, 26], [60, 30], [58, 46], [42, 44]]) // bucket
      wheel(ctx, 15, 45, 8); wheel(ctx, 41, 45, 8)
    },
  },
  backhoe: {
    label: 'Backhoe', group: 'Dirt & lifting',
    draw: (ctx) => { // loader front, hoe up over the back
      box(ctx, 18, 24, 20, 16, 3)
      poly(ctx, [[36, 30], [52, 34], [52, 42], [36, 40]])
      poly(ctx, [[50, 30], [61, 34], [59, 46], [49, 44]])       // front bucket
      poly(ctx, [[22, 28], [6, 10], [13, 5], [28, 25]])          // rear boom
      poly(ctx, [[6, 10], [2, 22], [12, 21]])                    // rear bucket
      wheel(ctx, 24, 45, 6.5); wheel(ctx, 43, 45, 7.5)
    },
  },
  grader: {
    label: 'Grader', group: 'Dirt & lifting',
    draw: (ctx) => {
      box(ctx, 4, 18, 18, 20, 3)                                  // rear body + cab
      poly(ctx, [[20, 24], [56, 28], [56, 36], [20, 34]])         // long neck
      poly(ctx, [[30, 32], [42, 34], [36, 51], [24, 48]])         // center blade
      wheel(ctx, 9, 45, 6.5); wheel(ctx, 20, 45, 6.5); wheel(ctx, 52, 44, 6.5)
    },
  },
  roller: {
    label: 'Roller', group: 'Dirt & lifting',
    draw: (ctx) => {
      wheel(ctx, 47, 40, 13)                                      // drum
      cut(ctx, () => wheel(ctx, 47, 40, 4.5))
      box(ctx, 6, 20, 26, 18, 3)
      poly(ctx, [[30, 26], [46, 30], [44, 40], [30, 36]])
      wheel(ctx, 15, 45, 8)
    },
  },
  crane: {
    label: 'Crane', group: 'Dirt & lifting',
    draw: (ctx) => {
      box(ctx, 6, 44, 32, 11, 5.5)
      box(ctx, 8, 30, 22, 16, 3)
      poly(ctx, [[22, 34], [52, 4], [60, 10], [32, 38]])          // boom
      box(ctx, 54, 14, 7, 12, 2)                                  // hook block
    },
  },
  telehandler: {
    label: 'Telehandler', group: 'Dirt & lifting',
    draw: (ctx) => {
      box(ctx, 6, 26, 28, 16, 3)
      poly(ctx, [[8, 30], [48, 12], [54, 18], [16, 34]])          // telescoping boom
      poly(ctx, [[48, 12], [62, 12], [62, 18], [52, 18]])         // forks at tip
      wheel(ctx, 15, 46, 7); wheel(ctx, 35, 46, 7)
    },
  },
  forklift: {
    label: 'Forklift', group: 'Dirt & lifting',
    draw: (ctx) => {
      box(ctx, 44, 8, 7, 38, 2)                                   // mast
      box(ctx, 48, 42, 14, 6, 2)                                  // forks
      box(ctx, 12, 24, 32, 18, 4)
      wheel(ctx, 21, 46, 7); wheel(ctx, 40, 46, 6)
    },
  },
  'boom-lift': {
    label: 'Boom lift', group: 'Dirt & lifting',
    draw: (ctx) => {
      box(ctx, 8, 42, 30, 10, 4)
      wheel(ctx, 15, 50, 5); wheel(ctx, 32, 50, 5)
      poly(ctx, [[14, 44], [6, 22], [13, 19], [22, 42]])          // lower arm
      poly(ctx, [[6, 22], [40, 8], [43, 15], [13, 28]])           // upper arm
      box(ctx, 40, 2, 15, 13, 2)                                  // basket
    },
  },

  /* ── Ag & grounds ──────────────────────────────────────────────── */
  tractor: {
    label: 'Tractor', group: 'Ag & grounds',
    draw: (ctx) => {
      wheel(ctx, 18, 40, 14)
      cut(ctx, () => wheel(ctx, 18, 40, 5))
      wheel(ctx, 49, 46, 8)
      box(ctx, 24, 24, 28, 14, 3)
      box(ctx, 24, 10, 16, 16, 2)
      cut(ctx, () => box(ctx, 28, 14, 8, 8, 2))                   // cab glass
    },
  },
  mower: {
    label: 'Mower', group: 'Ag & grounds',
    draw: (ctx) => { // zero-turn: low deck, high seat back, front caster
      box(ctx, 6, 38, 40, 9, 3)                                   // deck
      box(ctx, 12, 26, 26, 14, 3)                                 // body
      box(ctx, 14, 10, 9, 20, 2)                                  // seat back
      poly(ctx, [[42, 42], [56, 45], [56, 50], [42, 48]])         // caster arm
      wheel(ctx, 14, 50, 5.5); wheel(ctx, 38, 48, 8)
      wheel(ctx, 54, 51, 5)                                       // front caster
    },
  },
  utv: {
    label: 'UTV', group: 'Ag & grounds',
    draw: (ctx) => { // open cage over a low body + rear bed
      box(ctx, 4, 30, 54, 13, 3)                                  // low body
      box(ctx, 6, 20, 14, 12, 2)                                  // rear bed
      box(ctx, 22, 10, 24, 9, 3)                                  // roof
      box(ctx, 22, 16, 8, 16, 2)                                  // rear pillar
      poly(ctx, [[38, 16], [46, 16], [52, 32], [44, 32]])         // front pillar
      wheel(ctx, 14, 45, 7.5); wheel(ctx, 46, 45, 7.5)
    },
  },

  /* ── Support ───────────────────────────────────────────────────── */
  trailer: {
    label: 'Trailer', group: 'Support',
    draw: (ctx) => {
      box(ctx, 4, 30, 42, 9, 2)
      poly(ctx, [[46, 32], [62, 38], [62, 43], [46, 40]])         // tongue
      box(ctx, 10, 22, 18, 9, 3)                                  // fender rail
      wheel(ctx, 15, 45, 6.5); wheel(ctx, 29, 45, 6.5)
    },
  },
  generator: {
    label: 'Generator', group: 'Support',
    draw: (ctx) => {
      box(ctx, 6, 18, 42, 28, 4)
      box(ctx, 22, 8, 12, 12, 2)                                  // lift eye
      cut(ctx, () => box(ctx, 13, 26, 10, 12, 2))                 // vent
      wheel(ctx, 16, 50, 5); wheel(ctx, 40, 50, 5)
    },
  },

  /* ── People & tools ────────────────────────────────────────────── */
  person: {
    label: 'Person', group: 'People & tools',
    draw: (ctx) => {
      wheel(ctx, 32, 19, 10)
      box(ctx, 14, 33, 36, 24, 13)
    },
  },
  wrench: {
    label: 'Wrench', group: 'People & tools',
    draw: (ctx) => {
      ctx.save()
      ctx.translate(32, 32)
      ctx.rotate(Math.PI / 4)
      ctx.beginPath(); rr(ctx, -5, -8, 10, 32, 5); ctx.fill()
      ctx.beginPath(); ctx.arc(0, -16, 12, 0, Math.PI * 2); ctx.fill()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath(); ctx.arc(0, -16, 6.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillRect(-5, -34, 10, 14)
      ctx.restore()
    },
  },
}

/** The four type defaults — exactly the glyphs every fleet rendered before
 *  per-asset icons existed, so an unset icon changes nothing. */
export const TYPE_DEFAULT_ICON: Record<AssetType, string> = {
  vehicle: 'pickup',
  equipment: 'excavator',
  personnel: 'person',
  tool: 'wrench',
}

/** Picker section order (object key order isn't guaranteed meaningful). */
export const ICON_GROUPS: AssetIconDef['group'][] =
  ['Trucks & road', 'Dirt & lifting', 'Ag & grounds', 'Support', 'People & tools']

/** metadata.icon → validated registry key, else the type default. */
export function resolveAssetIcon(type: AssetType, metadata?: Record<string, unknown> | null): string {
  const k = metadata?.icon
  if (typeof k === 'string' && ASSET_ICONS[k]) return k
  return TYPE_DEFAULT_ICON[type] ?? 'pickup'
}

/** Picker/preview rendering: the glyph as it appears on the map — a colored
 *  puck with the dark silhouette inside. Client-only (canvas). */
export function iconPreviewDataUrl(key: string, puck = '#ff9e16', glyph = '#04121d', size = 44): string {
  if (typeof document === 'undefined') return ''
  const def = ASSET_ICONS[key]
  if (!def) return ''
  const c = document.createElement('canvas')
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
  c.width = size * dpr; c.height = size * dpr
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.scale(dpr, dpr)
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2)
  ctx.fillStyle = puck; ctx.fill()
  // Glyph at ~62% of the puck, centered — matches the map's dot proportions.
  const g = size * 0.62
  ctx.save()
  ctx.translate((size - g) / 2, (size - g) / 2)
  ctx.scale(g / 64, g / 64)
  ctx.fillStyle = glyph
  def.draw(ctx)
  ctx.restore()
  return c.toDataURL()
}
