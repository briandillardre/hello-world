/**
 * Contours off an elevation grid — pure marching squares. Grid row 0 = south.
 * Segments at each level are joined into polylines, so the map draws lines,
 * not confetti. Index contours (every `indexEvery`-th level) are flagged for a
 * heavier line and a label. NaN cells (no data) break the line.
 */

export interface ElevGrid { nx: number; ny: number; z: ArrayLike<number> }
export interface ContourLine { level: number; index: boolean; pts: [number, number][] }

export function contourLevels(min: number, max: number, interval: number, maxLevels = 400): number[] {
  if (!(interval > 0) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return []
  const out: number[] = []
  for (let l = Math.ceil(min / interval) * interval; l <= max && out.length < maxLevels; l += interval) out.push(Math.round(l * 1e6) / 1e6)
  return out
}

/** Contour polylines in GRID coordinates (column, row). */
export function contours(g: ElevGrid, levels: number[], interval: number, indexEvery = 5): ContourLine[] {
  const { nx, ny, z } = g
  const at = (i: number, j: number) => z[j * nx + i]
  const out: ContourLine[] = []
  for (const L of levels) {
    const segs: [number, number, number, number][] = []
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1)
        if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue
        // nudge exact hits so a level never lands on a corner
        const s = (v: number) => (v === L ? v + 1e-9 : v)
        const A = s(a), B = s(b), C = s(c), D = s(d)
        const code = (A > L ? 8 : 0) | (B > L ? 4 : 0) | (C > L ? 2 : 0) | (D > L ? 1 : 0)
        if (code === 0 || code === 15) continue
        const lerp = (v0: number, v1: number) => (L - v0) / (v1 - v0)
        const bottom: [number, number] = [i + lerp(A, B), j]
        const right: [number, number] = [i + 1, j + lerp(B, C)]
        const top: [number, number] = [i + lerp(D, C), j + 1]
        const left: [number, number] = [i, j + lerp(A, D)]
        // a level through a grid node makes zero-length crumbs there — they would fork the join
        const add = (p: [number, number], q: [number, number]) => { if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) segs.push([p[0], p[1], q[0], q[1]]) }
        switch (code) {
          case 1: case 14: add(left, top); break
          case 2: case 13: add(top, right); break
          case 3: case 12: add(left, right); break
          case 4: case 11: add(bottom, right); break
          case 6: case 9: add(bottom, top); break
          case 7: case 8: add(left, bottom); break
          case 5: { const mid = (A + B + C + D) / 4; if (mid > L) { add(left, bottom); add(top, right) } else { add(left, top); add(bottom, right) } break }
          case 10: { const mid = (A + B + C + D) / 4; if (mid > L) { add(left, top); add(bottom, right) } else { add(left, bottom); add(top, right) } break }
        }
      }
    }
    const isIndex = Math.abs(Math.round(L / interval) % indexEvery) === 0
    for (const pts of join(segs)) if (pts.length >= 2) out.push({ level: L, index: isIndex, pts })
  }
  return out
}

/** Join segments that share endpoints into polylines. */
function join(segs: [number, number, number, number][]): [number, number][][] {
  const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`
  const ends = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { const l = ends.get(k) ?? []; l.push(i); ends.set(k, l) }
  })
  const used = new Uint8Array(segs.length)
  const lines: [number, number][][] = []
  const other = (i: number, k: string): [number, number] | null => {
    const s = segs[i]
    return key(s[0], s[1]) === k ? [s[2], s[3]] : [s[0], s[1]]
  }
  const walk = (start: [number, number], into: [number, number][]) => {
    let cur = start
    for (;;) {
      const k = key(cur[0], cur[1])
      const next = (ends.get(k) ?? []).find((i) => !used[i])
      if (next === undefined) return
      used[next] = 1
      const p = other(next, k)!
      into.push(p)
      cur = p
    }
  }
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    used[i] = 1
    const s = segs[i]
    const fwd: [number, number][] = [[s[0], s[1]], [s[2], s[3]]]
    walk([s[2], s[3]], fwd)
    const back: [number, number][] = []
    walk([s[0], s[1]], back)
    lines.push([...back.reverse(), ...fwd])
  }
  return lines
}

/** Drop points closer than `tol` grid units to the line through their neighbours (Douglas–Peucker). */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a], [bx, by] = pts[b]
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1
    let best = -1, far = 0
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l
      if (d > far) { far = d; best = i }
    }
    if (best >= 0 && far > tol) { keep[best] = 1; stack.push([a, best], [best, b]) }
  }
  return pts.filter((_, i) => keep[i])
}
