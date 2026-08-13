/**
 * Aircraft silhouettes + type intelligence for the live Aircraft layer.
 *
 * Five top-down silhouette classes drawn once onto a canvas atlas (nose up),
 * sampled by the sky renderer as rotated point sprites. ADS-B type codes map
 * to a shape class, REAL wingspan, and a friendly name — so a 172 renders
 * as a little straight-wing single and an A380 as the four-engine monster
 * it is, proportionally sized (with a visibility floor when zoomed out).
 */

export type PlaneClass = 'prop' | 'biz' | 'narrow' | 'wide' | 'heli'
export const PLANE_CLASS_INDEX: Record<PlaneClass, number> = { prop: 0, biz: 1, narrow: 2, wide: 3, heli: 4 }

/** Minimum on-screen wingspan in px per class — keeps distant traffic visible.
 *  Trimmed ~20% Aug 12 ("make them all a little smaller"). */
export const PLANE_FLOOR_PX: Record<PlaneClass, number> = { prop: 7, biz: 9, narrow: 11, wide: 13, heli: 8 }

interface TypeInfo { cls: PlaneClass; spanM: number; label?: string }

const TYPES: Record<string, TypeInfo> = {
  // ── Light singles / GA props ──
  C172: { cls: 'prop', spanM: 11.0, label: 'Cessna 172' },
  C152: { cls: 'prop', spanM: 10.2, label: 'Cessna 152' },
  C182: { cls: 'prop', spanM: 11.0, label: 'Cessna 182' },
  C206: { cls: 'prop', spanM: 11.0, label: 'Cessna 206' },
  C208: { cls: 'prop', spanM: 15.9, label: 'Cessna Caravan' },
  SR20: { cls: 'prop', spanM: 11.7, label: 'Cirrus SR20' },
  SR22: { cls: 'prop', spanM: 11.7, label: 'Cirrus SR22' },
  P28A: { cls: 'prop', spanM: 10.8, label: 'Piper Cherokee' },
  PA28: { cls: 'prop', spanM: 10.8, label: 'Piper Cherokee' },
  PA34: { cls: 'prop', spanM: 11.9, label: 'Piper Seneca' },
  BE36: { cls: 'prop', spanM: 10.2, label: 'Beech Bonanza' },
  BE58: { cls: 'prop', spanM: 11.5, label: 'Beech Baron' },
  DA40: { cls: 'prop', spanM: 11.9, label: 'Diamond DA40' },
  DA42: { cls: 'prop', spanM: 13.4, label: 'Diamond DA42' },
  M20P: { cls: 'prop', spanM: 11.0, label: 'Mooney M20' },
  // ── Turboprops (straight wing — same silhouette family) ──
  PC12: { cls: 'prop', spanM: 16.3, label: 'Pilatus PC-12' },
  TBM9: { cls: 'prop', spanM: 12.8, label: 'TBM 900' },
  TBM7: { cls: 'prop', spanM: 12.7, label: 'TBM 700' },
  BE20: { cls: 'prop', spanM: 17.7, label: 'King Air 200' },
  B350: { cls: 'prop', spanM: 17.7, label: 'King Air 350' },
  AT72: { cls: 'prop', spanM: 27.1, label: 'ATR 72' },
  AT76: { cls: 'prop', spanM: 27.1, label: 'ATR 72-600' },
  DH8D: { cls: 'prop', spanM: 28.4, label: 'Dash 8 Q400' },
  DH8A: { cls: 'prop', spanM: 25.9, label: 'Dash 8' },
  // ── Business jets ──
  C525: { cls: 'biz', spanM: 14.3, label: 'Citation CJ1' },
  C25A: { cls: 'biz', spanM: 15.2, label: 'Citation CJ2' },
  C25B: { cls: 'biz', spanM: 15.2, label: 'Citation CJ3' },
  C56X: { cls: 'biz', spanM: 17.2, label: 'Citation Excel' },
  C680: { cls: 'biz', spanM: 19.4, label: 'Citation Sovereign' },
  C750: { cls: 'biz', spanM: 19.4, label: 'Citation X' },
  E55P: { cls: 'biz', spanM: 16.2, label: 'Phenom 300' },
  E50P: { cls: 'biz', spanM: 12.3, label: 'Phenom 100' },
  CL30: { cls: 'biz', spanM: 19.4, label: 'Challenger 300' },
  CL35: { cls: 'biz', spanM: 21.0, label: 'Challenger 350' },
  CL60: { cls: 'biz', spanM: 19.6, label: 'Challenger 600' },
  GLF4: { cls: 'biz', spanM: 23.7, label: 'Gulfstream IV' },
  GLF5: { cls: 'biz', spanM: 28.5, label: 'Gulfstream V' },
  GLF6: { cls: 'biz', spanM: 30.4, label: 'Gulfstream G650' },
  GL7T: { cls: 'biz', spanM: 31.7, label: 'Global 7500' },
  LJ45: { cls: 'biz', spanM: 14.6, label: 'Learjet 45' },
  LJ60: { cls: 'biz', spanM: 13.4, label: 'Learjet 60' },
  HA4T: { cls: 'biz', spanM: 18.8, label: 'Hawker 4000' },
  H25B: { cls: 'biz', spanM: 15.7, label: 'Hawker 800' },
  F2TH: { cls: 'biz', spanM: 19.3, label: 'Falcon 2000' },
  FA7X: { cls: 'biz', spanM: 26.2, label: 'Falcon 7X' },
  // ── Narrowbody airliners ──
  B737: { cls: 'narrow', spanM: 34.3, label: 'Boeing 737' },
  B738: { cls: 'narrow', spanM: 35.8, label: 'Boeing 737-800' },
  B739: { cls: 'narrow', spanM: 35.8, label: 'Boeing 737-900' },
  B38M: { cls: 'narrow', spanM: 35.9, label: '737 MAX 8' },
  B39M: { cls: 'narrow', spanM: 35.9, label: '737 MAX 9' },
  B752: { cls: 'narrow', spanM: 38.0, label: 'Boeing 757' },
  B753: { cls: 'narrow', spanM: 38.0, label: 'Boeing 757-300' },
  A319: { cls: 'narrow', spanM: 35.8, label: 'Airbus A319' },
  A320: { cls: 'narrow', spanM: 35.8, label: 'Airbus A320' },
  A321: { cls: 'narrow', spanM: 35.8, label: 'Airbus A321' },
  A20N: { cls: 'narrow', spanM: 35.8, label: 'A320neo' },
  A21N: { cls: 'narrow', spanM: 35.8, label: 'A321neo' },
  BCS1: { cls: 'narrow', spanM: 35.1, label: 'A220-100' },
  BCS3: { cls: 'narrow', spanM: 35.1, label: 'A220-300' },
  E170: { cls: 'narrow', spanM: 26.0, label: 'Embraer 170' },
  E75L: { cls: 'narrow', spanM: 28.7, label: 'Embraer 175' },
  E190: { cls: 'narrow', spanM: 28.7, label: 'Embraer 190' },
  E195: { cls: 'narrow', spanM: 28.7, label: 'Embraer 195' },
  CRJ2: { cls: 'narrow', spanM: 21.2, label: 'CRJ-200' },
  CRJ7: { cls: 'narrow', spanM: 23.2, label: 'CRJ-700' },
  CRJ9: { cls: 'narrow', spanM: 24.9, label: 'CRJ-900' },
  MD82: { cls: 'narrow', spanM: 32.8, label: 'MD-82' },
  MD83: { cls: 'narrow', spanM: 32.8, label: 'MD-83' },
  // ── Widebodies ──
  B744: { cls: 'wide', spanM: 64.4, label: 'Boeing 747-400' },
  B748: { cls: 'wide', spanM: 68.4, label: 'Boeing 747-8' },
  B762: { cls: 'wide', spanM: 47.6, label: 'Boeing 767-200' },
  B763: { cls: 'wide', spanM: 47.6, label: 'Boeing 767-300' },
  B772: { cls: 'wide', spanM: 60.9, label: 'Boeing 777-200' },
  B77W: { cls: 'wide', spanM: 64.8, label: '777-300ER' },
  B77L: { cls: 'wide', spanM: 64.8, label: '777-200LR' },
  B788: { cls: 'wide', spanM: 60.1, label: '787-8 Dreamliner' },
  B789: { cls: 'wide', spanM: 60.1, label: '787-9 Dreamliner' },
  B78X: { cls: 'wide', spanM: 60.1, label: '787-10 Dreamliner' },
  A332: { cls: 'wide', spanM: 60.3, label: 'Airbus A330-200' },
  A333: { cls: 'wide', spanM: 60.3, label: 'Airbus A330-300' },
  A339: { cls: 'wide', spanM: 64.0, label: 'A330-900neo' },
  A359: { cls: 'wide', spanM: 64.7, label: 'Airbus A350-900' },
  A35K: { cls: 'wide', spanM: 64.7, label: 'Airbus A350-1000' },
  A388: { cls: 'wide', spanM: 79.8, label: 'Airbus A380' },
  MD11: { cls: 'wide', spanM: 51.7, label: 'MD-11' },
  A306: { cls: 'wide', spanM: 44.8, label: 'Airbus A300' },
  // ── Helicopters ──
  R44: { cls: 'heli', spanM: 10.1, label: 'Robinson R44' },
  R66: { cls: 'heli', spanM: 10.1, label: 'Robinson R66' },
  EC35: { cls: 'heli', spanM: 10.2, label: 'Airbus H135' },
  EC30: { cls: 'heli', spanM: 10.7, label: 'Airbus H130' },
  EC45: { cls: 'heli', spanM: 11.0, label: 'Airbus H145' },
  B06: { cls: 'heli', spanM: 10.2, label: 'Bell 206' },
  B407: { cls: 'heli', spanM: 10.7, label: 'Bell 407' },
  B429: { cls: 'heli', spanM: 11.0, label: 'Bell 429' },
  S76: { cls: 'heli', spanM: 13.4, label: 'Sikorsky S-76' },
  H60: { cls: 'heli', spanM: 16.4, label: 'Black Hawk' },
  A109: { cls: 'heli', spanM: 11.0, label: 'Agusta A109' },
}

/** Type code → shape class, real wingspan (m), friendly label. */
export function typeInfo(code: string | null): { cls: PlaneClass; spanM: number; label: string | null } {
  const t = (code ?? '').toUpperCase()
  const hit = TYPES[t]
  if (hit) return { cls: hit.cls, spanM: hit.spanM, label: hit.label ?? t }
  // Educated fallbacks by prefix, then a generic narrowbody.
  if (/^(C1|C2|P2|PA|SR|BE|DA|M2|RV|AA|G[A-Z]?\d)/.test(t) && t.length <= 4) return { cls: 'prop', spanM: 11, label: null }
  if (/^(B7|A3(0|1|2|3|5|8)|MD|E1|E2|CRJ|BCS)/.test(t)) return { cls: 'narrow', spanM: 34, label: null }
  if (/^(GLF|CL|LJ|C5|C6|C7|E5|FA|F2|HA|H2)/.test(t)) return { cls: 'biz', spanM: 18, label: null }
  if (/^(R4|R6|EC|AS|B0|B4|S7|H6|A10|UH)/.test(t)) return { cls: 'heli', spanM: 11, label: null }
  return { cls: 'narrow', spanM: 30, label: null }
}

// ── Silhouette atlas (5 cells × 128 px, nose up, white on transparent) ─────

export const ATLAS_CELLS = 5
const CELL = 128
/** Fraction of a cell the wingspan occupies — sizing math divides by this. */
export const SHAPE_SPAN_FRAC = 0.86

type Pt = [number, number]

function poly(ctx: CanvasRenderingContext2D, x0: number, pts: Pt[]) {
  ctx.beginPath()
  ctx.moveTo(x0 + pts[0][0] * CELL, pts[0][1] * CELL)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(x0 + pts[i][0] * CELL, pts[i][1] * CELL)
  ctx.closePath()
  ctx.fill()
}

/** Mirror the right-half outline (x ≥ 0.5) into a full symmetric polygon. */
function sym(right: Pt[]): Pt[] {
  const left: Pt[] = right.map(([x, y]) => [1 - x, y] as Pt).reverse()
  return [...right, ...left]
}

function drawProp(ctx: CanvasRenderingContext2D, x0: number) {
  poly(ctx, x0, sym([
    [0.5, 0.07], [0.545, 0.145], [0.545, 0.30],
    [0.93, 0.335], [0.93, 0.415], [0.55, 0.45],
    [0.545, 0.72], [0.71, 0.775], [0.71, 0.85], [0.525, 0.86], [0.51, 0.93],
  ]))
}

function drawBiz(ctx: CanvasRenderingContext2D, x0: number) {
  poly(ctx, x0, sym([
    [0.5, 0.05], [0.535, 0.145], [0.535, 0.40],
    [0.90, 0.585], [0.90, 0.645], [0.535, 0.545],
    [0.535, 0.775], [0.71, 0.875], [0.71, 0.925], [0.515, 0.895], [0.505, 0.955],
  ]))
}

function drawNarrow(ctx: CanvasRenderingContext2D, x0: number) {
  poly(ctx, x0, sym([
    [0.5, 0.035], [0.548, 0.125], [0.548, 0.355],
    [0.955, 0.585], [0.955, 0.65], [0.548, 0.525],
    [0.548, 0.74], [0.755, 0.865], [0.755, 0.92], [0.535, 0.87], [0.51, 0.945],
  ]))
  // under-wing engines
  ctx.fillRect(x0 + 0.335 * CELL, 0.435 * CELL, 0.052 * CELL, 0.115 * CELL)
  ctx.fillRect(x0 + (1 - 0.387) * CELL, 0.435 * CELL, 0.052 * CELL, 0.115 * CELL)
}

function drawWide(ctx: CanvasRenderingContext2D, x0: number) {
  poly(ctx, x0, sym([
    [0.5, 0.03], [0.558, 0.13], [0.558, 0.33],
    [0.97, 0.60], [0.97, 0.665], [0.558, 0.525],
    [0.558, 0.73], [0.77, 0.87], [0.77, 0.925], [0.545, 0.865], [0.515, 0.945],
  ]))
  // four engines
  for (const ex of [0.30, 0.405]) {
    const ey = ex < 0.35 ? 0.475 : 0.415
    ctx.fillRect(x0 + ex * CELL, ey * CELL, 0.05 * CELL, 0.115 * CELL)
    ctx.fillRect(x0 + (1 - ex - 0.05) * CELL, ey * CELL, 0.05 * CELL, 0.115 * CELL)
  }
}

function drawHeli(ctx: CanvasRenderingContext2D, x0: number) {
  const cx = x0 + 0.5 * CELL
  // body
  ctx.beginPath()
  ctx.ellipse(cx, 0.5 * CELL, 0.085 * CELL, 0.17 * CELL, 0, 0, Math.PI * 2)
  ctx.fill()
  // tail boom + rotor nub
  ctx.fillRect(cx - 0.02 * CELL, 0.6 * CELL, 0.04 * CELL, 0.33 * CELL)
  ctx.fillRect(cx - 0.09 * CELL, 0.885 * CELL, 0.18 * CELL, 0.035 * CELL)
  // main rotor: four blades + hub
  ctx.save()
  ctx.translate(cx, 0.47 * CELL)
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 4 + (i > 0 ? Math.PI / 2 : 0))
    ctx.fillRect(-0.014 * CELL, -0.43 * CELL, 0.028 * CELL, 0.86 * CELL)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.arc(cx, 0.47 * CELL, 0.05 * CELL, 0, Math.PI * 2)
  ctx.fill()
}

/** Render the atlas — one canvas, five cells, nose-up white silhouettes. */
export function buildPlaneAtlas(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = CELL * ATLAS_CELLS
  c.height = CELL
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  drawProp(ctx, 0)
  drawBiz(ctx, CELL)
  drawNarrow(ctx, CELL * 2)
  drawWide(ctx, CELL * 3)
  drawHeli(ctx, CELL * 4)
  return c
}
