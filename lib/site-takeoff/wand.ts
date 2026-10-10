/**
 * The magic wand — pure. A tap inside a surface on the customer's own drone
 * picture grows a region of pixels that look like the tap (colour in CIE Lab,
 * plus a texture guard), cleans it up (close → fill holes → keep the piece
 * that holds the tap), traces its outline and simplifies it to an editable
 * polygon in PIXEL coordinates. The editor maps pixels to lng/lat
 * (lib/site-takeoff/quad.ts).
 *
 * It is an ASSIST: shadows, oil stains and paint change colour, so the UI
 * always hands the result over as an editable shape to check.
 */

export interface Pixels {
  width: number
  height: number
  /** RGBA, row-major (ImageData.data). */
  data: ArrayLike<number>
}

export interface WandOptions {
  /** 0–100: how different a pixel may look and still join. Default 30. */
  tolerance?: number
  /** Closing radius in pixels (bridges paint lines and cracks). Default 2. */
  closeRadius?: number
  /** Douglas–Peucker tolerance in pixels. Default 1.5. */
  simplify?: number
  /** Stop growing past this many pixels. Default 4,000,000. */
  maxPixels?: number
}

export interface WandResult {
  /** Outline in pixel-corner coordinates (x right, y down), no closing point. */
  ring: [number, number][]
  /** Pixels in the cleaned region. */
  pixels: number
  /** The grow hit maxPixels — the region probably leaked. */
  capped: boolean
}

function srgbToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)

/** sRGB → CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b)
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const fx = fLab(x), fy = fLab(y), fz = fLab(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Lab per pixel, packed L,a,b. */
export function labImage(img: Pixels): Float32Array {
  const n = img.width * img.height
  const out = new Float32Array(n * 3)
  const cache = new Map<number, [number, number, number]>()
  for (let i = 0; i < n; i++) {
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2]
    const key = (r << 16) | (g << 8) | b
    let lab = cache.get(key)
    if (!lab) { lab = rgbToLab(r, g, b); if (cache.size < 200_000) cache.set(key, lab) }
    out[i * 3] = lab[0]; out[i * 3 + 1] = lab[1]; out[i * 3 + 2] = lab[2]
  }
  return out
}

/** Tolerance slider (0–100) → ΔE in Lab. 30 ≈ ΔE 14. */
export function deltaEFor(tolerance: number): number {
  const t = Math.max(0, Math.min(100, tolerance))
  return 3 + t * 0.37
}

/**
 * Grow from (sx, sy): 4-connected, a pixel joins when its Lab colour is within
 * ΔE of the SEED's 5×5 mean (a fixed reference — a running mean drifts along
 * a gradient into the lawn) and its 3×3 neighbourhood is not much busier than
 * the seed's (texture guard: turf and gravel are busy, asphalt is not).
 */
export function growRegion(img: Pixels, sx: number, sy: number, opts: WandOptions = {}, lab = labImage(img)): { mask: Uint8Array; count: number; capped: boolean } {
  const W = img.width, H = img.height
  const mask = new Uint8Array(W * H)
  sx = Math.floor(sx); sy = Math.floor(sy)
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return { mask, count: 0, capped: false }
  const maxPixels = opts.maxPixels ?? 4_000_000
  const dE = deltaEFor(opts.tolerance ?? 30)

  let L = 0, A = 0, B = 0, n = 0
  for (let y = Math.max(0, sy - 2); y <= Math.min(H - 1, sy + 2); y++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(W - 1, sx + 2); x++) {
      const i = (y * W + x) * 3
      L += lab[i]; A += lab[i + 1]; B += lab[i + 2]; n++
    }
  }
  L /= n; A /= n; B /= n

  const busy = (x: number, y: number) => {
    let s = 0, s2 = 0, k = 0
    for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
        const l = lab[(yy * W + xx) * 3]; s += l; s2 += l * l; k++
      }
    }
    const m = s / k
    return Math.sqrt(Math.max(0, s2 / k - m * m))
  }
  const seedBusy = busy(sx, sy)
  const busyMax = Math.max(6, seedBusy * 2.5 + dE * 0.6)

  const stack: number[] = [sy * W + sx]
  mask[sy * W + sx] = 1
  let count = 1
  let capped = false
  while (stack.length) {
    const p = stack.pop()!
    const x = p % W, y = (p - x) / W
    const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]
    for (const q of nb) {
      if (q < 0 || mask[q]) continue
      const i = q * 3
      const d = Math.hypot(lab[i] - L, lab[i + 1] - A, lab[i + 2] - B)
      if (d > dE) continue
      const qx = q % W
      if (busy(qx, (q - qx) / W) > busyMax) continue
      mask[q] = 1; count++
      if (count >= maxPixels) { capped = true; stack.length = 0; break }
      stack.push(q)
    }
  }
  return { mask, count, capped }
}

/** Binary dilation (r > 0) or erosion (r < 0) with a square of radius |r|. Separable. */
export function morph(mask: Uint8Array, W: number, H: number, r: number): Uint8Array {
  if (r === 0) return mask.slice()
  const grow = r > 0
  const R = Math.abs(r)
  const tmp = new Uint8Array(W * H)
  const out = new Uint8Array(W * H)
  // Rows: running count of set pixels in the window.
  for (let y = 0; y < H; y++) {
    const row = y * W
    let c = 0
    for (let x = 0; x < Math.min(W, R); x++) c += mask[row + x]
    for (let x = 0; x < W; x++) {
      if (x + R < W) c += mask[row + x + R]
      if (x - R - 1 >= 0) c -= mask[row + x - R - 1]
      const win = Math.min(W - 1, x + R) - Math.max(0, x - R) + 1
      tmp[row + x] = grow ? (c > 0 ? 1 : 0) : (c === win ? 1 : 0)
    }
  }
  for (let x = 0; x < W; x++) {
    let c = 0
    for (let y = 0; y < Math.min(H, R); y++) c += tmp[y * W + x]
    for (let y = 0; y < H; y++) {
      if (y + R < H) c += tmp[(y + R) * W + x]
      if (y - R - 1 >= 0) c -= tmp[(y - R - 1) * W + x]
      const win = Math.min(H - 1, y + R) - Math.max(0, y - R) + 1
      out[y * W + x] = grow ? (c > 0 ? 1 : 0) : (c === win ? 1 : 0)
    }
  }
  return out
}

/** Keep only the 4-connected piece holding (sx, sy). */
export function keepComponent(mask: Uint8Array, W: number, H: number, sx: number, sy: number): Uint8Array {
  const out = new Uint8Array(W * H)
  const s = sy * W + sx
  if (!mask[s]) return out
  const stack = [s]
  out[s] = 1
  while (stack.length) {
    const p = stack.pop()!
    const x = p % W
    const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W]
    for (const q of nb) {
      if (q < 0 || q >= W * H || out[q] || !mask[q]) continue
      out[q] = 1; stack.push(q)
    }
  }
  return out
}

/** Fill every hole (unset pixels not connected to the border). */
export function fillHoles(mask: Uint8Array, W: number, H: number): Uint8Array {
  const outside = new Uint8Array(W * H)
  const stack: number[] = []
  const seed = (p: number) => { if (!mask[p] && !outside[p]) { outside[p] = 1; stack.push(p) } }
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x) }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1) }
  while (stack.length) {
    const p = stack.pop()!
    const x = p % W
    if (x > 0) seed(p - 1)
    if (x < W - 1) seed(p + 1)
    if (p - W >= 0) seed(p - W)
    if (p + W < W * H) seed(p + W)
  }
  const out = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) out[i] = outside[i] ? 0 : 1
  return out
}

/**
 * Outline of the mask along pixel edges (crack following), as rings of
 * pixel-corner points. Every boundary edge is directed with the region on its
 * right (y down), and edges are chained into loops; the longest is the outer
 * outline of a hole-free piece.
 */
export function traceOutline(mask: Uint8Array, W: number, H: number): [number, number][] {
  const VW = W + 1
  const next = new Map<number, number[]>()
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const a = ay * VW + ax
    const list = next.get(a)
    const b = by * VW + bx
    if (list) list.push(b); else next.set(a, [b])
  }
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!on(x, y)) continue
      if (!on(x, y - 1)) add(x, y, x + 1, y)
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!on(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  let best: number[] = []
  for (const start of Array.from(next.keys())) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [start]
      let cur = next.get(start)!.pop()!
      let guard = 0
      while (cur !== start && guard++ < 4 * W * H + 8) {
        loop.push(cur)
        const l = next.get(cur)
        if (!l || l.length === 0) break
        cur = l.pop()!
      }
      if (loop.length > best.length) best = loop
    }
  }
  return best.map(v => [v % VW, Math.floor(v / VW)] as [number, number])
}

/** Douglas–Peucker on a closed ring (no closing point). */
export function simplifyRing(ring: [number, number][], eps: number): [number, number][] {
  if (ring.length <= 4) return ring.slice()
  // Split at the vertex farthest from vertex 0 so both halves are open chains.
  let far = 0, fd = -1
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1])
    if (d > fd) { fd = d; far = i }
  }
  const dp = (pts: [number, number][]): [number, number][] => {
    const keep = new Uint8Array(pts.length)
    keep[0] = 1; keep[pts.length - 1] = 1
    const st: [number, number][] = [[0, pts.length - 1]]
    while (st.length) {
      const [a, b] = st.pop()!
      const [ax, ay] = pts[a], [bx, by] = pts[b]
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy)
      let md = -1, mi = -1
      for (let i = a + 1; i < b; i++) {
        const d = L ? Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
        if (d > md) { md = d; mi = i }
      }
      if (md > eps && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]) }
    }
    return pts.filter((_, i) => keep[i])
  }
  const a = dp(ring.slice(0, far + 1))
  const b = dp([...ring.slice(far), ring[0]])
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

/** Shoelace area of a pixel ring (absolute). */
export function ringPixelArea(r: [number, number][]): number {
  let s = 0
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length]
    s += x0 * y1 - x1 * y0
  }
  return Math.abs(s) / 2
}

/** The whole wand: grow → close → fill holes → keep the tapped piece → outline → simplify. */
export function magicWand(img: Pixels, sx: number, sy: number, opts: WandOptions = {}, lab?: Float32Array): WandResult | null {
  const W = img.width, H = img.height
  const { mask, capped } = growRegion(img, sx, sy, opts, lab)
  const r = Math.max(0, Math.round(opts.closeRadius ?? 2))
  let m = r > 0 ? morph(morph(mask, W, H, r), W, H, -r) : mask
  m = fillHoles(m, W, H)
  // Opening by 1 drops one-pixel hairs that leaked along a seam.
  const opened = morph(morph(m, W, H, -1), W, H, 1)
  const ix = Math.floor(sx), iy = Math.floor(sy)
  m = keepComponent(opened[iy * W + ix] ? opened : m, W, H, ix, iy)
  let pixels = 0
  for (let i = 0; i < m.length; i++) pixels += m[i]
  if (pixels < 9) return null
  const outline = traceOutline(m, W, H)
  if (outline.length < 4) return null
  const ring = simplifyRing(outline, opts.simplify ?? 1.5)
  return ring.length >= 3 ? { ring, pixels, capped } : null
}
