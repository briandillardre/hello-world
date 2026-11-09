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
  group: 'Basic' | 'Trucks & road' | 'Dirt & lifting' | 'Ag & grounds' | 'Trailers & site' | 'People & tools'
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
/** An SVG path in the 64-space, filled even-odd (an inner ring is a window). */
const svg = (ctx: CanvasRenderingContext2D, d: string) => { ctx.fill(new Path2D(d), 'evenodd') }
/** Several wheels at one height. */
const wheels = (ctx: CanvasRenderingContext2D, y: number, r: number, ...xs: number[]) => { for (const x of xs) wheel(ctx, x, y, r) }

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
    label: 'Dump truck (tri-axle)', group: 'Trucks & road',
    draw: (ctx) => { // dump body with the cab shield over the cab, conventional hood, tandem rear
      svg(ctx, 'M3 24L39 18V40H3Z')
      svg(ctx, 'M37 14H51V18H37Z')
      svg(ctx, 'M42 20H51V29H58L61 33V45H42Z M44.5 22.5H49V28H44.5Z')
      ctx.fillRect(3, 40, 58, 4)
      wheels(ctx, 47, 7, 12, 27, 53)
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
  'end-dump': {
    label: 'End dump (tractor + trailer)', group: 'Trucks & road',
    draw: (ctx) => { // long tub sloped at the tail on a trailer, day cab tractor
      svg(ctx, 'M2 19H37L40 24V36H7L2 30Z')
      ctx.fillRect(30, 36, 16, 4)
      svg(ctx, 'M44 19H54V29H61V45H44Z M47 22H52V28H47Z')
      wheels(ctx, 47, 6, 8, 20, 41, 55)
    },
  },
  'articulated-truck': {
    label: 'Articulated dump (ADT)', group: 'Trucks & road',
    draw: (ctx) => { // tall cab tractor, hinge, big dump body, three big axles
      svg(ctx, 'M2 15H37L41 21L39 38H7L2 27Z')
      svg(ctx, 'M41 26L44 12H56L58 25H62V42H40Z M46.5 15H53.5L55 23H45.5Z')
      wheels(ctx, 46, 8, 11, 27, 52)
    },
  },
  'haul-truck': {
    label: 'Haul truck (rigid)', group: 'Trucks & road',
    draw: (ctx) => { // off-highway: huge tyres, body with canopy over the cab
      svg(ctx, 'M2 15L48 11V17H41V35H6L2 25Z')
      svg(ctx, 'M42 19H54V27H58V40H41Z M44.5 21H51.5V26H44.5Z')
      wheels(ctx, 44, 10, 16, 48)
    },
  },
  lowboy: {
    label: 'Lowboy (tractor + trailer)', group: 'Trucks & road',
    draw: (ctx) => { // drop deck rising to the gooseneck, day cab tractor
      svg(ctx, 'M2 37H32L36 29H45V35H39V43H2Z')
      svg(ctx, 'M43 16H53V27H61V45H43Z M46 19H51V26H46Z')
      wheels(ctx, 48, 5.5, 7, 18); wheels(ctx, 48, 6, 44, 56)
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
    draw: (ctx) => { // tracks, house + cab, bent boom, stick, toothed bucket
      box(ctx, 3, 43, 38, 11, 5.5)
      svg(ctx, 'M5 32H34V43H5Z')
      svg(ctx, 'M20 18H33V33H20Z M23 21H30V28H23Z')
      svg(ctx, 'M30 36L42 9L49 11L37 38Z')
      svg(ctx, 'M42 9L48 6L60 29L55 32Z')
      svg(ctx, 'M53 29L62 28L61 41L57 44L51 37Z')
    },
  },
  'mini-excavator': {
    label: 'Mini excavator', group: 'Dirt & lifting',
    draw: (ctx) => { // short tracks with a dozer blade, canopy, short boom
      box(ctx, 8, 44, 30, 10, 5)
      ctx.fillRect(38, 44, 5, 10)
      svg(ctx, 'M8 33H32V44H8Z')
      svg(ctx, 'M12 16H30V19H27V33H24V19H18V33H15V19H12Z')
      svg(ctx, 'M29 38L40 16L46 18L35 40Z')
      svg(ctx, 'M40 16L46 13L55 33L50 35Z')
      svg(ctx, 'M48 33L57 32L56 43L52 45L46 39Z')
    },
  },
  'track-loader': {
    label: 'Compact track loader', group: 'Dirt & lifting',
    draw: (ctx) => { // skid steer on rubber tracks
      svg(ctx, 'M10 18H34V44H10Z M21 26H31V36H21Z')
      svg(ctx, 'M14 18L20 14L46 30L42 36L16 24Z')
      svg(ctx, 'M42 30H60L58 47H43Z')
      box(ctx, 7, 43, 34, 11, 5.5)
    },
  },
  scraper: {
    label: 'Scraper', group: 'Dirt & lifting',
    draw: (ctx) => { // bowl at the back, gooseneck forward to the tractor
      svg(ctx, 'M2 22H34L38 31L34 44H8L2 37Z')
      svg(ctx, 'M31 23L45 15L49 21L36 30Z')
      svg(ctx, 'M42 20H54V28H61V42H42Z M45 22.5H51V27H45Z')
      wheel(ctx, 14, 45, 9); wheel(ctx, 51, 45, 9)
    },
  },
  'rt-crane': {
    label: 'Rough-terrain crane', group: 'Dirt & lifting',
    draw: (ctx) => { // carrier on four big tyres, side cab, telescoping boom
      svg(ctx, 'M3 34H57V44H3Z')
      svg(ctx, 'M12 24H32V35H12Z')
      svg(ctx, 'M33 25H43V35H33Z M35.5 27.5H40.5V31.5H35.5Z')
      svg(ctx, 'M14 28L46 10L49 16L18 33Z')
      svg(ctx, 'M45 11L58 4L60 8L47 15Z')
      ctx.fillRect(57.5, 7, 2.5, 18)
      box(ctx, 55, 23, 7, 7, 2)
      wheels(ctx, 47, 7.5, 12, 48)
    },
  },
  'scissor-lift': {
    label: 'Scissor lift', group: 'Dirt & lifting',
    draw: (ctx) => { // platform with rails on crossed arms over a low base
      svg(ctx, 'M4 4H58V8H54V14H8V8H4Z')
      ctx.fillRect(4, 14, 54, 5)
      ctx.save(); ctx.lineWidth = 4; ctx.strokeStyle = ctx.fillStyle as string
      ctx.beginPath(); ctx.moveTo(10, 19); ctx.lineTo(52, 31); ctx.lineTo(10, 43)
      ctx.moveTo(52, 19); ctx.lineTo(10, 31); ctx.lineTo(52, 43); ctx.stroke(); ctx.restore()
      box(ctx, 4, 42, 54, 7, 2)
      wheels(ctx, 50, 4.5, 12, 50)
    },
  },
  paver: {
    label: 'Asphalt paver', group: 'Dirt & lifting',
    draw: (ctx) => { // hopper up front, operator deck under a canopy, screed behind
      svg(ctx, 'M44 26L61 21L59 41H44Z')
      svg(ctx, 'M12 28H46V42H12Z')
      svg(ctx, 'M10 10H40V14H36V28H32V14H18V28H14V14H10Z')
      svg(ctx, 'M1 38H14V48H1Z')
      box(ctx, 12, 43, 34, 11, 5.5)
    },
  },
  dozer: {
    label: 'Dozer', group: 'Dirt & lifting',
    draw: (ctx) => { // high-drive track, cab + hood, curved blade, rear ripper
      svg(ctx, 'M5 54H45L49 47L43 40H9L2 47Z')
      svg(ctx, 'M24 28H45V40H24Z')
      svg(ctx, 'M9 15H26V40H9Z M12 18H23V27H12Z')
      ctx.fillRect(42, 36, 11, 5)
      svg(ctx, 'M51 21Q46 37 51 54H58V21Z')
      svg(ctx, 'M1 33H7V49L3 54H1Z')
    },
  },
  'skid-steer': {
    label: 'Skid steer', group: 'Dirt & lifting',
    draw: (ctx) => { // boxy cab between the wheels, lift arms from the back, bucket
      svg(ctx, 'M10 18H34V44H10Z M21 26H31V36H21Z')
      svg(ctx, 'M14 18L20 14L46 30L42 36L16 24Z')
      svg(ctx, 'M42 30H60L58 47H43Z')
      wheels(ctx, 48, 6.5, 16, 32)
    },
  },
  'wheel-loader': {
    label: 'Wheel loader', group: 'Dirt & lifting',
    draw: (ctx) => { // rear engine + cab, lift arm, big bucket, big tyres
      svg(ctx, 'M3 28H32V40H3Z')
      svg(ctx, 'M14 11H30V30H14Z M17 14H27V22H17Z')
      ctx.fillRect(30, 31, 10, 9)
      svg(ctx, 'M32 30H49V36L33 39Z')
      svg(ctx, 'M47 21L60 25L62 42H47Q44 31 47 21Z')
      wheels(ctx, 45, 9, 14, 40)
    },
  },
  backhoe: {
    label: 'Backhoe', group: 'Dirt & lifting',
    draw: (ctx) => { // cab between a front loader bucket and the rear hoe
      svg(ctx, 'M18 22H38V40H18Z M22 25H34V32H22Z')
      ctx.fillRect(36, 32, 14, 6)
      svg(ctx, 'M48 27L61 31L59 46H48Z')
      svg(ctx, 'M21 30L7 9L14 5L27 27Z')
      svg(ctx, 'M7 9L1 25L9 25L12 14Z')
      wheel(ctx, 25, 46, 7.5); wheel(ctx, 45, 47, 6)
    },
  },
  grader: {
    label: 'Motor grader', group: 'Dirt & lifting',
    draw: (ctx) => { // tandem rear + cab, long arched frame, mid blade, front wheel
      svg(ctx, 'M2 30H22V42H2Z')
      svg(ctx, 'M9 13H23V32H9Z M12 16H20V24H12Z')
      svg(ctx, 'M20 31L57 29L59 36L22 38Z')
      ctx.fillRect(32, 36, 5, 8)
      svg(ctx, 'M24 43H46L48 50H22Z')
      wheels(ctx, 48, 6, 8, 20, 54)
    },
  },
  roller: {
    label: 'Roller', group: 'Dirt & lifting',
    draw: (ctx) => { // smooth drum up front in its yoke, cab + rear tyre
      svg(ctx, 'M34 29H47V38H34Z')
      wheel(ctx, 47, 43, 11)
      svg(ctx, 'M4 30H34V42H4Z')
      svg(ctx, 'M10 13H26V31H10Z M13 16H23V24H13Z')
      wheel(ctx, 15, 45, 9)
    },
  },
  crane: {
    label: 'Crawler crane', group: 'Dirt & lifting',
    draw: (ctx) => { // tracks, house, long lattice boom, hook block
      box(ctx, 3, 44, 34, 10, 5)
      svg(ctx, 'M4 31H30V44H4Z')
      svg(ctx, 'M26 29H36V41H26Z M28.5 31.5H33.5V36H28.5Z')
      svg(ctx, 'M19 34L56 2L61 7L25 38Z M28 30L38 21L41 24L31 33Z M42 18L51 10L53 13L45 21Z')
      ctx.fillRect(57, 6, 2.5, 22)
      box(ctx, 54, 26, 8, 8, 2)
    },
  },
  telehandler: {
    label: 'Telehandler', group: 'Dirt & lifting',
    draw: (ctx) => { // low frame, side cab, boom from the rear up to the forks
      svg(ctx, 'M4 34H52V42H4Z')
      svg(ctx, 'M26 20H38V36H26Z M28.5 22.5H35.5V29H28.5Z')
      svg(ctx, 'M2 31L47 13L50 19L6 37Z')
      ctx.fillRect(47, 11, 5, 16)
      ctx.fillRect(49, 23, 13, 4)
      wheels(ctx, 46, 7.5, 14, 44)
    },
  },
  forklift: {
    label: 'Forklift', group: 'Dirt & lifting',
    draw: (ctx) => { // overhead guard, mast, forks, counterweight
      svg(ctx, 'M6 28Q6 24 10 24H44V44H6Z')
      svg(ctx, 'M20 10H42V14H38V26H34V14H24V26H20Z')
      ctx.fillRect(45, 6, 6, 42)
      ctx.fillRect(48, 43, 14, 4)
      wheel(ctx, 16, 47, 7); wheel(ctx, 39, 48, 6)
    },
  },
  'boom-lift': {
    label: 'Boom lift', group: 'Dirt & lifting',
    draw: (ctx) => { // chassis + turret, folding boom, basket with rails
      box(ctx, 6, 42, 36, 8, 3)
      wheels(ctx, 51, 5, 13, 35)
      ctx.fillRect(12, 34, 14, 9)
      svg(ctx, 'M14 36L6 18L12 15L21 34Z')
      svg(ctx, 'M6 18L43 9L45 15L10 23Z')
      svg(ctx, 'M42 2H60V14H42Z M45 5H57V8H45Z')
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
    label: 'Utility trailer', group: 'Trailers & site',
    draw: (ctx) => {
      box(ctx, 4, 30, 42, 9, 2)
      poly(ctx, [[46, 32], [62, 38], [62, 43], [46, 40]])         // tongue
      box(ctx, 10, 22, 18, 9, 3)                                  // fender rail
      wheel(ctx, 15, 45, 6.5); wheel(ctx, 29, 45, 6.5)
    },
  },
  generator: {
    label: 'Generator', group: 'Trailers & site',
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

  /* ── Sep 4 additions (Brian: "basic dot, mowers, leaf blowers, trailers
     etc."). Same rules: ≥8px features, side view facing right, ground ≈52. */
  dot: {
    label: 'Plain dot', group: 'Basic',
    draw: () => { /* just the colored dot — no silhouette */ },
  },
  blower: {
    label: 'Leaf blower', group: 'People & tools',
    draw: (ctx) => {
      box(ctx, 8, 12, 9, 30, 3)                                   // backpack frame
      box(ctx, 16, 16, 22, 26, 6)                                 // engine housing
      box(ctx, 22, 6, 12, 10, 3)                                  // top handle
      poly(ctx, [[38, 26], [60, 33], [60, 45], [38, 37]])         // tube, flaring right
    },
  },
  chainsaw: {
    label: 'Chainsaw', group: 'People & tools',
    draw: (ctx) => {
      box(ctx, 6, 24, 26, 18, 5)                                  // powerhead
      box(ctx, 10, 14, 16, 10, 3)                                 // top handle
      box(ctx, 30, 28, 30, 9, 4)                                  // bar
    },
  },
  'plate-compactor': {
    label: 'Plate compactor', group: 'People & tools',
    draw: (ctx) => {
      box(ctx, 8, 44, 40, 9, 2)                                   // plate
      box(ctx, 16, 22, 22, 22, 5)                                 // engine
      poly(ctx, [[36, 28], [56, 8], [62, 14], [42, 34]])          // handle
    },
  },
  'concrete-saw': {
    label: 'Concrete saw', group: 'People & tools',
    draw: (ctx) => {
      box(ctx, 8, 24, 30, 18, 5)                                  // body
      poly(ctx, [[10, 24], [4, 8], [12, 6], [18, 24]])            // handle
      wheel(ctx, 46, 40, 12)                                      // blade
      cut(ctx, () => wheel(ctx, 46, 40, 4))                       // arbor
      wheel(ctx, 16, 48, 6)                                       // rear wheel
    },
  },
  toolbox: {
    label: 'Toolbox', group: 'People & tools',
    draw: (ctx) => {
      box(ctx, 8, 24, 48, 24, 5)
      box(ctx, 24, 16, 16, 10, 4)                                 // handle
    },
  },
  bucket: {
    label: 'Bucket / attachment', group: 'People & tools',
    draw: (ctx) => {
      poly(ctx, [[8, 18], [40, 18], [50, 30], [42, 50], [8, 50]])
      cut(ctx, () => poly(ctx, [[16, 26], [36, 26], [40, 32], [36, 42], [16, 42]]))
    },
  },
  'light-tower': {
    label: 'Light tower', group: 'Trailers & site',
    draw: (ctx) => {
      box(ctx, 6, 40, 40, 9, 2)                                   // trailer bed
      box(ctx, 26, 8, 8, 34, 2)                                   // mast
      box(ctx, 14, 2, 32, 11, 3)                                  // light bar
      wheel(ctx, 16, 51, 6); wheel(ctx, 36, 51, 6)
    },
  },
  pump: {
    label: 'Pump', group: 'Trailers & site',
    draw: (ctx) => {
      box(ctx, 12, 22, 30, 22, 5)                                 // body
      box(ctx, 4, 28, 10, 10, 2)                                  // inlet
      box(ctx, 40, 12, 10, 16, 2)                                 // outlet riser
      wheel(ctx, 18, 50, 6); wheel(ctx, 40, 50, 6)
    },
  },
  'message-board': {
    label: 'Message board', group: 'Trailers & site',
    draw: (ctx) => {
      box(ctx, 8, 6, 44, 26, 3)                                   // panel
      cut(ctx, () => poly(ctx, [[18, 19], [36, 10], [36, 28]]))   // arrow
      box(ctx, 26, 32, 8, 10, 2)                                  // mast
      box(ctx, 8, 42, 42, 8, 2)                                   // trailer
      wheel(ctx, 18, 52, 6); wheel(ctx, 40, 52, 6)
    },
  },
  'equipment-trailer': {
    label: 'Equipment trailer', group: 'Trailers & site',
    draw: (ctx) => {
      box(ctx, 4, 32, 44, 8, 2)                                   // deck
      box(ctx, 6, 18, 8, 14, 2); box(ctx, 16, 18, 8, 14, 2)       // stowed ramps
      poly(ctx, [[48, 33], [62, 40], [62, 46], [48, 40]])         // tongue
      wheel(ctx, 24, 46, 6.5); wheel(ctx, 38, 46, 6.5)            // tandem
    },
  },
  'dump-trailer': {
    label: 'Dump trailer', group: 'Trailers & site',
    draw: (ctx) => {
      box(ctx, 6, 14, 40, 8, 3)                                   // rim
      poly(ctx, [[6, 20], [44, 20], [46, 40], [8, 40]])           // tub
      poly(ctx, [[46, 34], [62, 40], [62, 46], [46, 41]])         // tongue
      wheel(ctx, 20, 47, 6.5); wheel(ctx, 34, 47, 6.5)
    },
  },
  'enclosed-trailer': {
    label: 'Enclosed trailer', group: 'Trailers & site',
    draw: (ctx) => {
      box(ctx, 4, 12, 44, 30, 5)                                  // box body
      poly(ctx, [[48, 34], [62, 40], [62, 46], [48, 41]])         // tongue
      wheel(ctx, 18, 48, 6.5); wheel(ctx, 34, 48, 6.5)
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
  ['Basic', 'Trucks & road', 'Dirt & lifting', 'Ag & grounds', 'Trailers & site', 'People & tools']

/** Own-property test that runs on every phone. `Object.hasOwn` is ES2022 —
 *  Samsung Internet and older Android System WebViews (Chromium < 93) throw
 *  "Object.hasOwn is not a function", which took /map down on Brian's phone
 *  three times on Sep 4. Never call Object.hasOwn in browser code. */
export const hasOwn = (obj: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key)

/** metadata.icon → validated registry key, else the type default. */
export function resolveAssetIcon(type: AssetType, metadata?: Record<string, unknown> | null): string {
  const k = metadata?.icon
  // Own-property test, not truthiness: 'constructor'/'__proto__' are
  // inherited object members and would pass a plain lookup, then request an
  // unregistered glyph image (ship-check).
  if (typeof k === 'string' && hasOwn(ASSET_ICONS, k)) return k
  return TYPE_DEFAULT_ICON[type] ?? 'pickup'
}

/** Picker/preview rendering — the dot EXACTLY as the live map draws it: a
 *  colored puck with the map's 2px dark ring and the dark silhouette at the
 *  map's proportion (icon-size 0.19 × 64 ≈ 12px inside a radius-10 dot →
 *  61% of the diameter). Rendered at the display size × the real device
 *  pixel ratio (up to 3×) so phones get crisp edges, not a downscaled blur.
 *  Client-only (canvas). */
export function iconPreviewDataUrl(key: string, puck = '#ff9e16', glyph = '#04121d', size = 44, ring = '#04121d'): string {
  if (typeof document === 'undefined') return ''
  const def = hasOwn(ASSET_ICONS, key) ? ASSET_ICONS[key] : undefined
  if (!def) return ''
  const c = document.createElement('canvas')
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
  c.width = Math.round(size * dpr); c.height = Math.round(size * dpr)
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  ctx.scale(dpr, dpr)
  // Map dot: radius 10, stroke 2 → the ring is a fifth of the radius.
  const r = size / 2 - 0.5
  const stroke = Math.max(1.5, r * 0.2)
  ctx.beginPath(); ctx.arc(size / 2, size / 2, r - stroke / 2, 0, Math.PI * 2)
  ctx.fillStyle = puck; ctx.fill()
  ctx.lineWidth = stroke; ctx.strokeStyle = ring; ctx.stroke()
  const g = (2 * r) * 0.61
  ctx.save()
  ctx.translate((size - g) / 2, (size - g) / 2)
  ctx.scale(g / 64, g / 64)
  ctx.fillStyle = glyph
  def.draw(ctx)
  ctx.restore()
  return c.toDataURL()
}
