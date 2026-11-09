/**
 * Overlay compare of two versions of a sheet — pure (pixels in, pixels out).
 *
 * The Bluebeam convention Brian's estimators read without a legend: the OLD
 * version's ink in red, the NEW version's in blue, and whatever did not
 * change prints dark because both inks land on it. Change clouds ring the
 * clusters of ink that only one version has; "Next change" steps through
 * them in reading order (top to bottom, left to right).
 */

const ink = (px: Uint8ClampedArray, i: number) => 1 - (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255

/** old → red, new → blue, both → dark. All three are RGBA of one size. */
export function composite(oldPx: Uint8ClampedArray, newPx: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const n = Math.min(oldPx.length, newPx.length, out.length)
  for (let i = 0; i < n; i += 4) {
    const a = ink(oldPx, i), b = ink(newPx, i)
    out[i] = 255 * (1 - b)
    out[i + 1] = 255 * (1 - Math.max(a, b))
    out[i + 2] = 255 * (1 - a)
    out[i + 3] = 255
  }
}

export interface ChangeBox { x0: number; y0: number; x1: number; y1: number; pixels: number }

/** A pixel counts as changed when one version inked it and the other did not
 *  — anti-aliasing differences stay under this. */
const CHANGED = 0.45

/**
 * Clusters of changed ink, as pixel boxes in reading order. `cell` is the
 * grid the pixels are counted in; neighbouring busy cells (one empty cell
 * apart included) join one cloud.
 */
export function changeBoxes(oldPx: Uint8ClampedArray, newPx: Uint8ClampedArray, w: number, h: number, cell = 24): ChangeBox[] {
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell)
  const count = new Uint32Array(gw * gh)
  for (let y = 0; y < h; y++) {
    const row = y * w
    const gy = Math.floor(y / cell) * gw
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4
      if (Math.abs(ink(oldPx, i) - ink(newPx, i)) > CHANGED) count[gy + Math.floor(x / cell)]++
    }
  }
  const MIN_CELL = 6
  const hot = new Uint8Array(gw * gh)
  for (let k = 0; k < hot.length; k++) hot[k] = count[k] >= MIN_CELL ? 1 : 0
  // Join across a one-cell gap: label on the dilated grid.
  const grown = new Uint8Array(gw * gh)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!hot[gy * gw + gx]) continue
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx, y = gy + dy
      if (x >= 0 && y >= 0 && x < gw && y < gh) grown[y * gw + x] = 1
    }
  }
  const label = new Int32Array(gw * gh).fill(-1)
  const boxes: ChangeBox[] = []
  const stack: number[] = []
  for (let k = 0; k < grown.length; k++) {
    if (!grown[k] || label[k] >= 0) continue
    const id = boxes.length
    const b = { gx0: Infinity, gy0: Infinity, gx1: -Infinity, gy1: -Infinity, pixels: 0 }
    label[k] = id
    stack.push(k)
    while (stack.length) {
      const c = stack.pop()!
      const cx = c % gw, cy = (c - cx) / gw
      if (hot[c]) {
        b.pixels += count[c]
        if (cx < b.gx0) b.gx0 = cx
        if (cx > b.gx1) b.gx1 = cx
        if (cy < b.gy0) b.gy0 = cy
        if (cy > b.gy1) b.gy1 = cy
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx, y = cy + dy
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue
        const j = y * gw + x
        if (grown[j] && label[j] < 0) { label[j] = id; stack.push(j) }
      }
    }
    boxes.push({
      x0: Math.max(0, b.gx0 * cell - cell / 2), y0: Math.max(0, b.gy0 * cell - cell / 2),
      x1: Math.min(w, (b.gx1 + 1) * cell + cell / 2), y1: Math.min(h, (b.gy1 + 1) * cell + cell / 2),
      pixels: b.pixels,
    })
  }
  return boxes
    .filter((b) => b.pixels >= 20 && Number.isFinite(b.x0))
    .sort((a, b) => (Math.round(a.y0 / (cell * 4)) - Math.round(b.y0 / (cell * 4))) || a.x0 - b.x0)
    .slice(0, 200)
}

/**
 * Canvas matrix [a, b, c, d, e, f] that draws the OLDER page (its page points,
 * y DOWN, the way a canvas reads it) onto the NEWER page's canvas, given
 * `t` = older page → newer page in page points with y UP (the corners' space,
 * lib/plans/match.ts) and `k` = canvas pixels per newer page point. So a
 * re-plotted sheet — shifted, turned, or at another scale on the paper — is
 * compared by its drawing, not by where it sat on the paper.
 */
export function alignedMatrix(t: { s: number; th: number; tx: number; ty: number }, oldH: number, newH: number, k: number): [number, number, number, number, number, number] {
  const C = t.s * Math.cos(t.th), S = t.s * Math.sin(t.th)
  return [k * C, -k * S, k * S, k * C, k * (t.tx - S * oldH), k * (newH - C * oldH - t.ty)]
}
