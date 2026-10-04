/**
 * A plan sheet's linework and words, straight from its PDF — pure (it walks
 * a pdf.js operator list; the caller does the pdf.js calls).
 *
 * Civil sets are vector drawings: every contour, curb and property line is a
 * stroked path with a pen (colour, width, dash) and, when the CAD export kept
 * them, a LAYER name ("C-TOPO-MAJR", "116-…_TOPO|EP"). Words come two ways:
 * real PDF text, and AutoCAD's SHX text — drawn as tiny strokes, with the
 * words themselves riding along as "AutoCAD SHX Text" comments (a Square
 * annotation whose contents are the text and whose rect is where it sits).
 * Both land here as `PdfText`.
 *
 * Coordinates are PDF user space (points, y up) after every transform —
 * `plan-read.ts` reasons in that space and `plan-geo.ts` takes it to the map.
 */

export interface PdfPen {
  id: number
  /** Optional-content (CAD layer) name, when the export kept layers. */
  layer: string | null
  /** "#rrggbb" stroke colour. */
  color: string
  /** Line width in points (after transforms). */
  width: number
  /** Dash pattern in points ("" = solid), e.g. "9,4.5". */
  dash: string
}

export interface PdfLine {
  pen: number
  /** x0,y0,x1,y1,… PDF user space. */
  pts: number[]
  closed: boolean
}

export interface PdfText {
  str: string
  /** Centre of the words. */
  x: number
  y: number
  /** Reading direction, radians (0 = left to right along +x). */
  angle: number
  /** Letter height, points. */
  size: number
  /** Length along the reading direction, points. */
  len: number
  src: 'text' | 'shx'
}

type Mat = [number, number, number, number, number, number]

/** Words longer than this are notes, never labels or spot grades (and a PDF can't hang the reader with a huge one). */
const MAX_WORDS = 200
/** A dash pattern is a handful of numbers; a PDF's 100,000-entry one is cut. */
const MAX_DASH = 16
const IDENT: Mat = [1, 0, 0, 1, 0, 0]

function mul(m: Mat, n: Mat): Mat {
  // m then n (PDF's cm: new CTM = m × CTM)
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ]
}

const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1

/** pdf.js DrawOPS (shared/util.js): the path data inside constructPath. */
const MOVE = 0, LINE = 1, CURVE = 2, QUAD = 3, CLOSE = 4

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}

function colorOf(args: unknown, kind: 'rgb' | 'gray' | 'cmyk'): string | null {
  const a = args as unknown[]
  if (kind === 'rgb') {
    if (typeof a?.[0] === 'string' && /^#[0-9a-f]{6}$/i.test(a[0] as string)) return (a[0] as string).toLowerCase()
    if (a?.length === 3) return `#${hex2(Number(a[0]) * 255)}${hex2(Number(a[1]) * 255)}${hex2(Number(a[2]) * 255)}`
    return null
  }
  if (kind === 'gray') { const g = hex2(Number(a?.[0]) * 255); return `#${g}${g}${g}` }
  const [c, m, y, k] = (a ?? []).map(Number)
  return `#${hex2(255 * (1 - c) * (1 - k))}${hex2(255 * (1 - m) * (1 - k))}${hex2(255 * (1 - y) * (1 - k))}`
}

interface GState { ctm: Mat; width: number; dash: number[]; color: string }

export interface OpList { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> }

/**
 * Every stroked path on the page as polylines, grouped by pen. Fills
 * (hatches, glyphs, solids) and clip paths are skipped — contours are strokes.
 * Curves are flattened to ≤ ~0.5 pt chords.
 */
export function extractVectors(
  ops: OpList,
  OPS: Record<string, number>,
  layerName: (id: string) => string | null = () => null,
): { pens: PdfPen[]; lines: PdfLine[] } {
  const pens: PdfPen[] = []
  const penIdx = new Map<string, number>()
  const lines: PdfLine[] = []
  const stack: GState[] = []
  let gs: GState = { ctm: [...IDENT] as Mat, width: 1, dash: [], color: '#000000' }
  const mc: (string | null)[] = []
  const formStack: GState[] = []
  const STROKES = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter(n => n !== undefined))
  const CLOSES = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter(n => n !== undefined))

  const penFor = (): number => {
    let layer: string | null = null
    for (let i = mc.length - 1; i >= 0; i--) if (mc[i]) { layer = mc[i]; break }
    const s = scaleOf(gs.ctm)
    const width = Math.round(Math.max(gs.width, 0) * s * 100) / 100
    const dash = gs.dash.length && gs.dash.some(d => d > 0) ? gs.dash.map(d => Math.round(d * s * 10) / 10).join(',') : ''
    const key = `${layer ?? ''}|${gs.color}|${width}|${dash}`
    let id = penIdx.get(key)
    if (id === undefined) {
      id = pens.length
      pens.push({ id, layer, color: gs.color, width, dash })
      penIdx.set(key, id)
    }
    return id
  }

  const n = ops.fnArray.length
  for (let i = 0; i < n; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] as unknown[]
    switch (fn) {
      case OPS.save: stack.push({ ...gs, ctm: [...gs.ctm] as Mat, dash: [...gs.dash] }); break
      case OPS.restore: gs = stack.pop() ?? gs; break
      case OPS.transform: gs.ctm = mul(args as unknown as Mat, gs.ctm); break
      case OPS.paintFormXObjectBegin: {
        // A form is drawn inside save/restore with its own matrix (pdf.js canvas does the same).
        formStack.push({ ...gs, ctm: [...gs.ctm] as Mat, dash: [...gs.dash] })
        const m = args?.[0] as number[] | null
        if (Array.isArray(m) || ArrayBuffer.isView(m)) gs.ctm = mul(Array.from(m as ArrayLike<number>) as Mat, gs.ctm)
        break
      }
      case OPS.paintFormXObjectEnd: gs = formStack.pop() ?? gs; break
      case OPS.setLineWidth: gs.width = Number(args?.[0]) || 0; break
      case OPS.setDash: gs.dash = Array.isArray(args?.[0]) ? (args[0] as number[]).slice(0, MAX_DASH).map(Number) : []; break
      case OPS.setStrokeRGBColor: gs.color = colorOf(args, 'rgb') ?? gs.color; break
      case OPS.setStrokeGray: gs.color = colorOf(args, 'gray') ?? gs.color; break
      case OPS.setStrokeCMYKColor: gs.color = colorOf(args, 'cmyk') ?? gs.color; break
      case OPS.setGState: {
        for (const kv of (args?.[0] as [string, unknown][]) ?? []) {
          if (kv[0] === 'LW') gs.width = Number(kv[1]) || 0
          else if (kv[0] === 'D' && Array.isArray(kv[1])) gs.dash = Array.isArray((kv[1] as unknown[])[0]) ? ((kv[1] as unknown[])[0] as number[]).slice(0, MAX_DASH).map(Number) : []
        }
        break
      }
      case OPS.beginMarkedContentProps: {
        const props = args?.[1] as { type?: string; id?: string } | null
        mc.push(args?.[0] === 'OC' && props?.id ? layerName(String(props.id)) : null)
        break
      }
      case OPS.beginMarkedContent: mc.push(null); break
      case OPS.endMarkedContent: mc.pop(); break
      case OPS.constructPath: {
        const paint = args?.[0] as number
        if (!STROKES.has(paint)) break
        const data = (args?.[1] as ArrayLike<number>[] | undefined)?.[0]
        if (!data) break
        const pen = penFor()
        const m = gs.ctm
        const tx = (x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
        const s = scaleOf(m)
        let cur: number[] = []
        let start: [number, number] | null = null
        let at: [number, number] = [0, 0]
        const flush = (closed: boolean) => {
          if (cur.length >= 4) lines.push({ pen, pts: cur, closed })
          cur = []
        }
        for (let k = 0; k < data.length;) {
          const op = data[k++]
          if (op === MOVE) {
            flush(false)
            at = [data[k++], data[k++]]
            start = at
            cur = tx(at[0], at[1])
          } else if (op === LINE) {
            at = [data[k++], data[k++]]
            if (!cur.length && start) cur = tx(start[0], start[1])
            cur.push(...tx(at[0], at[1]))
          } else if (op === CURVE || op === QUAD) {
            const c = op === CURVE ? [data[k++], data[k++], data[k++], data[k++], data[k++], data[k++]] : [data[k++], data[k++], data[k++], data[k++]]
            const p0 = at
            const end: [number, number] = op === CURVE ? [c[4], c[5]] : [c[2], c[3]]
            const span = Math.hypot(end[0] - p0[0], end[1] - p0[1]) * s
            const steps = Math.max(2, Math.min(32, Math.ceil(span / 2)))
            if (!cur.length) cur = tx(p0[0], p0[1])
            for (let t = 1; t <= steps; t++) {
              const u = t / steps, v = 1 - u
              let x: number, y: number
              if (op === CURVE) {
                x = v * v * v * p0[0] + 3 * v * v * u * c[0] + 3 * v * u * u * c[2] + u * u * u * c[4]
                y = v * v * v * p0[1] + 3 * v * v * u * c[1] + 3 * v * u * u * c[3] + u * u * u * c[5]
              } else {
                x = v * v * p0[0] + 2 * v * u * c[0] + u * u * c[2]
                y = v * v * p0[1] + 2 * v * u * c[1] + u * u * c[3]
              }
              cur.push(...tx(x, y))
            }
            at = end
          } else if (op === CLOSE) {
            if (start && cur.length >= 4) {
              const [sx, sy] = tx(start[0], start[1])
              if (Math.abs(cur[cur.length - 2] - sx) > 1e-6 || Math.abs(cur[cur.length - 1] - sy) > 1e-6) cur.push(sx, sy)
            }
            flush(true)
            at = start ?? at
          } else {
            break // unknown op: stop reading this path rather than misread it
          }
        }
        flush(CLOSES.has(paint))
        break
      }
    }
  }
  return { pens, lines }
}

/** Real PDF text items (pdf.js getTextContent). */
export function textFromContent(items: ArrayLike<{ str?: string; transform?: number[]; width?: number; height?: number }>): PdfText[] {
  const out: PdfText[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    // Labels and spot grades are short: a long run of words (or a booby-trapped one) is never read.
    const str = (it.str ?? '').replace(/\s+/g, ' ').trim()
    if (!str || str.length > MAX_WORDS || !it.transform) continue
    const [a, b, c, d, e, f] = it.transform
    const angle = Math.atan2(b, a)
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 1
    const len = Number(it.width) || str.length * size * 0.6
    const ux = Math.cos(angle), uy = Math.sin(angle)
    // Origin is the baseline start; the centre is half the run along, half a height up.
    out.push({ str, x: e + ux * len / 2 - uy * size * 0.4, y: f + uy * len / 2 + ux * size * 0.4, angle, size, len, src: 'text' })
  }
  return out
}

/**
 * AutoCAD SHX text: the words ride as Square annotations titled "AutoCAD SHX
 * Text". The rect is axis-aligned around the (possibly rotated) words, so the
 * angle is unknown — its long side is the best guess for size.
 */
export function textFromShx(annots: ArrayLike<{ subtype?: string; rect?: number[]; contentsObj?: { str?: string }; contents?: string; titleObj?: { str?: string }; title?: string }>): PdfText[] {
  const out: PdfText[] = []
  for (let i = 0; i < annots.length; i++) {
    const a = annots[i]
    const title = a.titleObj?.str ?? a.title ?? ''
    if (!/shx/i.test(title)) continue
    const str = (a.contentsObj?.str ?? a.contents ?? '').replace(/\s+/g, ' ').trim()
    if (!str || str.length > MAX_WORDS || !a.rect || a.rect.length < 4) continue
    const [x0, y0, x1, y1] = a.rect
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
    const along = Math.max(w, h), across = Math.min(w, h)
    out.push({ str, x: (x0 + x1) / 2, y: (y0 + y1) / 2, angle: w >= h ? 0 : Math.PI / 2, size: Math.max(across, 1), len: along, src: 'shx' })
  }
  return out
}
