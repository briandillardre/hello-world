'use client'

/**
 * Read a placed plan sheet: contours with their elevations, spot grades, the
 * finished-floor pad and the limit of grading come straight off the PDF's
 * linework and land where the sheet sits on the map. The PDF is read on this
 * device — it is never uploaded; only what's imported goes into the takeoff.
 *
 * pdf.js pulls the page's strokes and words (lib/dirt/pdf-vectors.ts), the
 * worker reads them (lib/dirt/plan-read.ts), the placement maps them
 * (lib/dirt/plan-geo.ts). The estimator confirms the pens, fixes what the
 * read couldn't name (tap a contour, or draw a line across a run of them),
 * then imports.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileUp, Loader2, Ruler, X } from 'lucide-react'
import { extractVectors, textFromContent, textFromShx, type PdfLine, type PdfText } from '@/lib/dirt/pdf-vectors'
import { assignAlong, resolveElevations, type PenSummary, type PlanContour, type PlanRead, type Role } from '@/lib/dirt/plan-read'
import { rasterScale, sheetMap, type SheetGeo, type SheetMap } from '@/lib/dirt/plan-geo'
import { lidarAtPage } from '@/lib/dirt/plan-lidar'
import { readToFeatures, type ImportBudget, type ImportResult } from '@/lib/dirt/plan-import'
import { newId } from '@/lib/dirt/features'
import type { GroundGrid } from '@/lib/dirt/takeoff'
import type { PlanSheet } from '@/lib/db/dirt'
import type { PlanWorkerOut } from '@/lib/dirt/plan-worker'
import NumField from './NumField'

type PdfjsModule = typeof import('pdfjs-dist')
type PdfDoc = import('pdfjs-dist').PDFDocumentProxy
type PdfPage = import('pdfjs-dist').PDFPageProxy

/** pdf.js from /public with a native import — webpack must never bundle it (see ZonePlans). */
async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import(/* webpackIgnore: true */ '/pdfjs/pdf.min.mjs' as string) as PdfjsModule
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
  return pdfjs
}

/** "Combined Bid Set.pdf — p7" → the file and page the sheet was placed from. */
export function captionParts(caption: string | null): { file: string | null; page: number | null } {
  const m = caption?.match(/^(.*?)\s+—\s+p(\d+)$/)
  return m ? { file: m[1], page: Number(m[2]) } : { file: caption, page: null }
}

// ── Is this the page that was placed? ──────────────────────────────────────

const THUMB = 120

function grayOf(src: CanvasImageSource, w: number, h: number): Float32Array | null {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(src, 0, 0, w, h)
  let d: ImageData
  try { d = ctx.getImageData(0, 0, w, h) } catch { return null } // a tainted image (no CORS): can't compare
  const out = new Float32Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * d.data[4 * i] + 0.587 * d.data[4 * i + 1] + 0.114 * d.data[4 * i + 2]
  return out
}

/** Normalised cross-correlation over the middle of the sheet (title blocks repeat on every page). */
function ncc(a: Float32Array, b: Float32Array, w: number, h: number): number {
  const x0 = Math.floor(w * 0.08), x1 = Math.ceil(w * 0.8), y0 = Math.floor(h * 0.08), y1 = Math.ceil(h * 0.92)
  let sa = 0, sb = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sa += a[y * w + x]; sb += b[y * w + x]; n++ }
  const ma = sa / n, mb = sb / n
  let ab = 0, aa = 0, bb = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = a[y * w + x] - ma, q = b[y * w + x] - mb
    ab += p * q; aa += p * p; bb += q * q
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}

async function pageGray(page: PdfPage, w: number, h: number): Promise<Float32Array | null> {
  const base = page.getViewport({ scale: 1 })
  const vp = page.getViewport({ scale: Math.max(w / base.width, h / base.height) })
  const c = document.createElement('canvas')
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height)
  const ctx = c.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise
  const g = grayOf(c, w, h)
  c.width = 0; c.height = 0
  return g
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('image'))
    img.src = url
  })
}

// ── Words for what the read did ────────────────────────────────────────────

const HOW_WORDS: Record<string, string> = {
  label: "the plan's own label",
  ladder: 'counted between labels',
  'tie-in': 'meets existing at the grading limits',
  lidar: 'snapped to the USGS lidar',
  extrapolated: 'guessed from the trend — check it',
  user: 'you set it',
}

const ROLE_WORDS: Record<Role, string> = { eg: 'Existing', fg: 'Proposed', none: 'Not contours' }

/** Elevation colours: low blue → high red (contours read by colour, so a misfit stands out). */
const RAMP = ['#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#ef4444']
function rampAt(t: number): string {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = parseInt(RAMP[i].slice(1), 16), b = parseInt(RAMP[i + 1].slice(1), 16)
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - f) + ((b >> s) & 255) * f)
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`
}

/** A contour's identity across re-reads (roles changed, lidar arrived): where it starts and how long it is. */
function contourKey(c: PlanContour): string {
  let len = 0
  for (let i = 2; i < c.pts.length; i += 2) len += Math.hypot(c.pts[i] - c.pts[i - 2], c.pts[i + 1] - c.pts[i - 1])
  const a = `${Math.round(c.pts[0])},${Math.round(c.pts[1])}`, b = `${Math.round(c.pts[c.pts.length - 2])},${Math.round(c.pts[c.pts.length - 1])}`
  return `${c.role}:${a < b ? a + ':' + b : b + ':' + a}:${Math.round(len)}`
}

interface Loaded {
  geo: SheetGeo
  map: SheetMap
  pageNo: number
  lines: PdfLine[]
  texts: PdfText[]
  note: string | null
}

export interface ReadOverlay { fc: GeoJSON.FeatureCollection }

interface Props {
  sheet: PlanSheet
  /** The takeoff's grading limits (or the site zone) — where to read; the whole sheet without one. */
  area: [number, number][] | null
  ground: GroundGrid | null
  canEdit: boolean
  budget: ImportBudget
  existingSource: 'lidar' | 'traced'
  onOverlay: (fc: GeoJSON.FeatureCollection | null) => void
  /** A read contour tapped on the map. */
  pick: { id: number; key: number } | null
  /** Start (true) or cancel (false) drawing a line on the map. */
  onLineMode: (on: boolean) => void
  /** The line just finished on the map. */
  line: { key: number; coords: [number, number][] } | null
  onImport: (r: ImportResult, opts: { existing: 'traced' | 'lidar'; offsetFt: number | null }) => void
  onClose: () => void
}

export default function PlanReader(p: Props) {
  const { file: wantFile, page: wantPage } = captionParts(p.sheet.caption)
  const [phase, setPhase] = useState<'pick' | 'loading' | 'mismatch' | 'ready' | 'error'>('pick')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [pens, setPens] = useState<PenSummary[]>([])
  const [roles, setRoles] = useState<Record<number, Role>>({})
  const [base, setBase] = useState<PlanRead | null>(null)
  const [reading, setReading] = useState(false)
  const [userZ, setUserZ] = useState<Record<string, number>>({})
  const [excluded, setExcluded] = useState<Record<string, true>>({})
  const [sel, setSel] = useState<number | null>(null)
  const [penShown, setPenShown] = useState<number | null>(null)
  const [allPens, setAllPens] = useState(false)
  const [lineForm, setLineForm] = useState<{ role: 'eg' | 'fg'; z0: number | undefined; dz: number; up: boolean } | null>(null)
  const [lineMsg, setLineMsg] = useState<string | null>(null)
  /** The last line drawn, kept so "number from N" can run it again with the labels' number. */
  const [lastLine, setLastLine] = useState<{ role: 'eg' | 'fg'; pts: number[]; dz: number; implied: number | null; typed: number } | null>(null)
  const [picks, setPicks] = useState({ egContours: true, fgContours: true, egSpots: true, fgSpots: true, limits: true, pads: {} as Record<number, boolean> })
  const [useForExisting, setUseForExisting] = useState(true)
  const [useDatum, setUseDatum] = useState(true)
  const [done, setDone] = useState<string | null>(null)
  const mismatch = useRef<{ doc: PdfDoc; pdfjs: PdfjsModule; img: HTMLImageElement; best: number; score: number } | null>(null)

  // ── Worker ──
  const worker = useRef<Worker | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    const w = new Worker(new URL('../../lib/dirt/plan-worker.ts', import.meta.url))
    worker.current = w
    w.onmessage = (e: MessageEvent<PlanWorkerOut>) => {
      const m = e.data
      if (m.seq !== seq.current) return // an older read finished after a newer one started
      setReading(false)
      if (m.type === 'error') { setError(`The read failed: ${m.error}`); setPhase('error'); return }
      if (m.type === 'loaded') { setPens(m.pens); setRoles(m.roles) }
      setBase(m.read)
      setPhase('ready')
    }
    return () => { w.terminate(); worker.current = null }
  }, [])

  const lidarFn = useMemo(() => (loaded && p.ground ? lidarAtPage(loaded.map, p.ground) : undefined), [loaded, p.ground])
  // Lidar that arrives after the read: read again with it.
  const sentGround = useRef<GroundGrid | null>(null)
  useEffect(() => {
    if (!loaded || phase !== 'ready' || !worker.current || p.ground === sentGround.current) return
    sentGround.current = p.ground
    seq.current++
    setReading(true)
    worker.current.postMessage({ type: 'ground', seq: seq.current, geo: loaded.geo, ground: p.ground })
  }, [p.ground, loaded, phase])

  // ── Open the PDF ──
  const begin = useCallback(async (doc: PdfDoc, pdfjs: PdfjsModule, img: HTMLImageElement, pageNo: number, note: string | null) => {
    setPhase('loading')
    setProgress(`Reading page ${pageNo}…`)
    const page = await doc.getPage(pageNo)
    const imgW = img.naturalWidth, imgH = img.naturalHeight
    const b0 = page.getViewport({ scale: 1 })
    let s = rasterScale(b0.width, b0.height)
    if (Math.ceil(b0.width * s) !== imgW || Math.ceil(b0.height * s) !== imgH) s = imgW / b0.width
    const vp = page.getViewport({ scale: s })
    const geo: SheetGeo = { vp: Array.from(vp.transform) as SheetGeo['vp'], imgW, imgH, corners: p.sheet.corners.slice(0, 4) as SheetGeo['corners'] }
    const map = sheetMap(geo)
    const [ops, tc, annots, oc] = await Promise.all([page.getOperatorList(), page.getTextContent(), page.getAnnotations(), doc.getOptionalContentConfig()])
    const names = new Map<string, string>()
    try { for (const [id, g] of Array.from(oc as unknown as Iterable<[string, { name?: string }]>)) names.set(id, g?.name ?? id) } catch { /* no layers */ }
    setProgress('Finding the contours…')
    const { pens: penList, lines } = extractVectors(ops, pdfjs.OPS as unknown as Record<string, number>, id => names.get(id) ?? null)
    const texts = [...textFromContent(tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]), ...textFromShx(annots as never[])]
    page.cleanup()
    // Read where the takeoff is (its grading limits, else the site), plus a margin for the ladders.
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null
    if (p.area && p.area.length >= 3) {
      const xs: number[] = [], ys: number[] = []
      for (const [lng, lat] of p.area) { const [x, y] = map.toPage(lng, lat); xs.push(x); ys.push(y) }
      const m = 60 * map.ptPerFt
      box = { x0: Math.min(...xs) - m, y0: Math.min(...ys) - m, x1: Math.max(...xs) + m, y1: Math.max(...ys) + m }
    }
    setLoaded({ geo, map, pageNo, lines, texts, note })
    seq.current++
    sentGround.current = p.ground
    setReading(true)
    worker.current?.postMessage({ type: 'load', seq: seq.current, input: { pens: penList, lines, texts, box, ptPerFt: map.ptPerFt }, geo, ground: p.ground })
  }, [p.area, p.ground, p.sheet.corners])

  const onFile = async (f: File) => {
    setError(null); setPhase('loading'); setProgress('Opening the PDF…'); setDone(null)
    try {
      const [pdfjs, img] = await Promise.all([
        loadPdfjs().catch(() => { throw new Error('reader') }),
        loadImage(p.sheet.url),
      ])
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise
      // Which page is this sheet? The caption says; the picture confirms.
      const k = THUMB / Math.max(img.naturalWidth, img.naturalHeight)
      const tw = Math.max(16, Math.round(img.naturalWidth * k)), th = Math.max(16, Math.round(img.naturalHeight * k))
      const want = grayOf(img, tw, th)
      const scoreOf = async (n: number) => {
        const g = await pageGray(await doc.getPage(n), tw, th)
        return g && want ? ncc(want, g, tw, th) : 0
      }
      const first = wantPage && wantPage <= doc.numPages ? wantPage : 1
      if (!want) { await begin(doc, pdfjs, img, first, null); return } // can't compare pictures here: trust the caption
      const s0 = await scoreOf(first)
      if (s0 >= 0.7) { await begin(doc, pdfjs, img, first, null); return }
      let best = first, bestS = s0, second = -1
      const n = Math.min(doc.numPages, 80)
      for (let i = 1; i <= n; i++) {
        if (i === first) continue
        setProgress(`Finding this sheet in the PDF… page ${i} of ${n}`)
        const sc = await scoreOf(i)
        if (sc > bestS) { second = bestS; bestS = sc; best = i } else if (sc > second) second = sc
      }
      if (bestS >= 0.55 && bestS - second >= 0.08) { await begin(doc, pdfjs, img, best, best !== first ? `This sheet is page ${best} of that PDF.` : null); return }
      mismatch.current = { doc, pdfjs, img, best, score: bestS }
      setPhase('mismatch')
    } catch (err) {
      const why = err instanceof Error ? err.message : ''
      setError(why === 'image' ? "The placed sheet's picture didn't load — check the connection and pick the PDF again."
        : why === 'reader' ? "The PDF reader didn't load — check the connection and pick the PDF again."
        : "That file didn't open as a PDF.")
      setPhase('error')
    }
  }

  // ── The read, with the estimator's edits on top ──
  const shown = useMemo(() => {
    if (!base || !loaded) return null
    const cs = base.contours.map(c => ({ ...c, flags: [...c.flags] }))
    const out = new Set<number>()
    for (const c of cs) {
      const k = contourKey(c)
      if (excluded[k]) out.add(c.id)
      if (userZ[k] !== undefined) { c.z = userZ[k]; c.how = 'user'; c.flags = c.flags.filter(f => !/labels disagree/.test(f)) }
    }
    // A set-aside line is not a contour: the ladders step over it.
    const ladders = out.size ? base.ladders.map(l => l.filter(id => !out.has(id))) : base.ladders
    const { datumFt } = resolveElevations(cs, ladders, { ...base.interval }, {
      lidar: lidarFn ? { at: lidarFn, spots: base.spots.filter(s => s.role === 'eg') } : undefined,
      ptPerFt: loaded.map.ptPerFt,
    })
    return { read: { ...base, contours: cs, ladders, datumFt }, out }
  }, [base, loaded, userZ, excluded, lidarFn])

  // ── The map overlay ──
  useEffect(() => {
    if (!shown || !loaded) { p.onOverlay(null); return }
    const { read, out } = shown
    const map = loaded.map
    const ll = (pts: number[]) => { const o: [number, number][] = []; for (let i = 0; i < pts.length; i += 2) o.push(map.toLngLat(pts[i], pts[i + 1])); return o }
    const zs = read.contours.filter(c => c.z !== null && !out.has(c.id)).map(c => c.z as number)
    const lo = zs.length ? Math.min(...zs) : 0, hi = zs.length ? Math.max(...zs) : 1
    const feats: GeoJSON.Feature[] = []
    if (penShown !== null) {
      for (const l of loaded.lines) if (l.pen === penShown) feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: ll(l.pts) }, properties: { k: 'pen' } })
    }
    for (const c of read.contours) {
      const ex = out.has(c.id)
      feats.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: ll(c.pts) },
        properties: {
          k: 'ct', rid: c.id, eg: c.role === 'eg' ? 1 : 0, unk: c.z === null ? 1 : 0, ex: ex ? 1 : 0,
          flag: c.flags.length && !ex ? 1 : 0, sel: sel === c.id ? 1 : 0,
          color: ex ? '#64748b' : c.z === null ? '#ffffff' : rampAt(hi > lo ? ((c.z as number) - lo) / (hi - lo) : 0.5),
          lbl: ex ? '' : c.z === null ? '?' : `${c.z}${c.how === 'extrapolated' ? '?' : ''}`,
        },
      })
    }
    for (const s of read.spots) {
      if (s.role === 'skip') continue
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: map.toLngLat(s.x, s.y) }, properties: { k: 'spot', eg: s.role === 'eg' ? 1 : 0, lbl: `${s.z.toFixed(2)}${s.tag ? ' ' + s.tag : ''}` } })
    }
    read.pads.forEach(pd => {
      if (!pd.outline) return
      const r = ll(pd.ring); r.push(r[0])
      feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [r] }, properties: { k: 'pad', lbl: `FF ${pd.ffe.toFixed(2)}` } })
    })
    if (read.limits) { const r = ll(read.limits); r.push(r[0]); feats.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [r] }, properties: { k: 'limit', lbl: 'Limit of grading' } }) }
    p.onOverlay({ type: 'FeatureCollection', features: feats })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, loaded, sel, penShown])
  useEffect(() => () => p.onOverlay(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  // A contour tapped on the map.
  useEffect(() => { if (p.pick) setSel(p.pick.id) }, [p.pick])

  // A line drawn across contours: number them in order.
  const runLine = (role: 'eg' | 'fg', pts: number[], z0: number, dz: number) => {
    if (!shown) return
    const cs = shown.read.contours.map(c => ({ ...c, flags: [...c.flags] }))
    const r = assignAlong(cs, role, pts, z0, dz, c => shown.out.has(c.id))
    if (r.disagree) {
      setLastLine({ role, pts, dz, implied: r.implied, typed: z0 })
      setLineMsg(`Nothing changed: ${r.disagree} contour${r.disagree === 1 ? '' : 's'} on that line already ${r.disagree === 1 ? 'has' : 'have'} a different number on the plan.`)
      return
    }
    setLastLine(null)
    const next = { ...userZ }
    cs.forEach((c, i) => { if (c.how === 'user' && shown.read.contours[i].how !== 'user') next[contourKey(c)] = c.z as number })
    setUserZ(next)
    setLineMsg(r.set ? `Numbered ${r.set} contour${r.set === 1 ? '' : 's'} along the line, from ${z0}.` : 'The line crossed no contours of that kind without a number already.')
  }
  useEffect(() => {
    if (!p.line || !lineForm || !shown || !loaded || lineForm.z0 === undefined) return
    const pts = p.line.coords.flatMap(([lng, lat]) => loaded.map.toPage(lng, lat))
    runLine(lineForm.role, pts, lineForm.z0, lineForm.up ? lineForm.dz : -lineForm.dz)
    setLineForm(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.line?.key])

  const setRole = (pen: number, role: Role) => {
    const next = { ...roles, [pen]: role }
    setRoles(next)
    seq.current++
    setReading(true)
    worker.current?.postMessage({ type: 'read', seq: seq.current, roles: next })
  }

  const read = shown?.read ?? null
  const selC = read && sel !== null ? read.contours.find(c => c.id === sel) ?? null : null
  const stats = useMemo(() => {
    if (!read || !shown) return null
    const live = read.contours.filter(c => !shown.out.has(c.id))
    const of = (r: 'eg' | 'fg') => { const a = live.filter(c => c.role === r); return { n: a.length, named: a.filter(c => c.z !== null).length, guessed: a.filter(c => c.how === 'extrapolated').length } }
    return { eg: of('eg'), fg: of('fg'), egSpots: read.spots.filter(s => s.role === 'eg').length, fgSpots: read.spots.filter(s => s.role === 'fg').length, flagged: live.filter(c => c.flags.length).length }
  }, [read, shown])

  const doImport = () => {
    if (!read || !loaded || !shown) return
    const padIdx = read.pads.map((_, i) => i).filter(i => picks.pads[i] ?? read.pads[i].outline)
    const r = readToFeatures(read, loaded.map, {
      egContours: picks.egContours, fgContours: picks.fgContours, egSpots: picks.egSpots, fgSpots: picks.fgSpots,
      pads: padIdx, limits: picks.limits, excluded: shown.out,
    }, p.budget, p.sheet.id, newId)
    const egIn = r.counts.egContours > 0
    p.onImport(r, {
      existing: egIn && useForExisting ? 'traced' : p.existingSource,
      offsetFt: !(egIn && useForExisting) && useDatum && read.datumFt !== null ? read.datumFt : null,
    })
    const c = r.counts
    const parts = [
      c.egContours && `${c.egContours} existing contours`, c.fgContours && `${c.fgContours} proposed contours`,
      c.egSpots + c.fgSpots && `${c.egSpots + c.fgSpots} spot grades`, c.pads && `${c.pads} building pad${c.pads === 1 ? '' : 's'}`, c.limits && 'the grading limits',
    ].filter(Boolean)
    setDone(`Added ${parts.join(', ') || 'nothing'}. Reading this sheet again replaces them.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}`)
  }

  // ── UI ──
  const contourPens = pens.filter(q => q.suggested !== 'none' || (roles[q.id] ?? 'none') !== 'none')
  const otherPens = pens.filter(q => !contourPens.includes(q) && q.length > 20 && !/^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/i.test(q.color))
  return (
    <div className="space-y-3 rounded-lg border border-cyan-500/40 bg-navy-950 p-2.5 text-xs">
      <div className="flex items-center gap-2">
        <FileUp className="h-4 w-4 text-cyan-300" />
        <div className="min-w-0 flex-1 font-semibold">Read {p.sheet.caption || 'this sheet'}</div>
        <button onClick={() => { p.onLineMode(false); p.onClose() }} className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-navy-800 hover:text-ink" aria-label="Close the reader"><X className="h-4 w-4" /></button>
      </div>

      {(phase === 'pick' || phase === 'error') && (
        <div className="space-y-2">
          <p className="text-muted">
            Pick the PDF this sheet came from{wantFile ? <> (<span className="text-ink">{wantFile}</span>)</> : ''}. It is read on this device and never uploaded — the contours, spot grades and pad land on the map where the sheet sits.
          </p>
          <label className="flex min-h-[40px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-cyan-600/90 px-3 py-2 font-semibold text-navy-950 hover:brightness-110">
            <FileUp className="h-4 w-4" /> Pick the PDF
            <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
          </label>
          {error && <p className="text-amber">{error}</p>}
        </div>
      )}

      {phase === 'loading' && (
        <div className="flex items-center gap-2 text-muted"><Loader2 className="h-4 w-4 animate-spin text-cyan-300" />{progress}</div>
      )}

      {phase === 'mismatch' && mismatch.current && (
        <div className="space-y-2 text-amber">
          <p className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />No page in that PDF looks like the sheet placed on the map{wantFile ? ` (it came from ${wantFile})` : ''}. A wrong page would put contours in the wrong place.</p>
          <div className="flex flex-wrap gap-2">
            <label className="flex min-h-[36px] cursor-pointer items-center rounded-lg border border-navy-700 px-3 text-ink hover:bg-navy-800">
              Pick another PDF
              <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = '' }} />
            </label>
            <button className="min-h-[36px] rounded-lg border border-navy-700 px-3 text-muted hover:bg-navy-800"
              onClick={() => { const m = mismatch.current!; void begin(m.doc, m.pdfjs, m.img, wantPage && wantPage <= m.doc.numPages ? wantPage : m.best, 'Read without a picture match — check that the contours sit on the sheet.') }}>
              Read page {wantPage && wantPage <= mismatch.current.doc.numPages ? wantPage : mismatch.current.best} anyway
            </button>
          </div>
        </div>
      )}

      {phase === 'ready' && read && stats && loaded && (
        <div className="space-y-3">
          {loaded.note && <p className="text-cyan-200">{loaded.note}</p>}
          <div className="flex items-center gap-2 text-muted">
            {reading && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />}
            <span>
              {stats.eg.n + stats.fg.n === 0 ? 'No contour linework found yet — pick its pens below.' : (
                <>
                  {stats.eg.n > 0 && <><b className="text-ink">{stats.eg.named}/{stats.eg.n}</b> existing</>}
                  {stats.eg.n > 0 && stats.fg.n > 0 && ' · '}
                  {stats.fg.n > 0 && <><b className="text-ink">{stats.fg.named}/{stats.fg.n}</b> proposed</>}
                  {' contours named'}
                  {read.interval.eg || read.interval.fg ? ` · every ${read.interval.fg ?? read.interval.eg} ft` : ''}
                </>
              )}
            </span>
          </div>
          {read.datumFt !== null && (
            <p className="text-muted">Plan datum = USGS lidar {read.datumFt >= 0 ? '+' : '−'} {Math.abs(read.datumFt).toFixed(1)} ft (from the labelled existing contours).</p>
          )}
          {read.warnings.filter(w => !/need an elevation/.test(w)).map(w => <p key={w} className="text-faint">{w}</p>)}

          {/* Selected contour */}
          {selC && (
            <div className="space-y-2 rounded-lg border border-amber/50 bg-navy-900 p-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{selC.role === 'eg' ? 'Existing' : 'Proposed'} contour</span>
                <span className="flex-1 text-muted">{selC.z !== null ? `${selC.z} ft · ${HOW_WORDS[selC.how ?? ''] ?? ''}` : 'no elevation yet'}</span>
                <button onClick={() => setSel(null)} className="text-muted hover:text-ink" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
              </div>
              {selC.flags.map(f => <p key={f} className="text-amber">• {f}</p>)}
              {p.canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <NumField step={0.5} min={-1500} max={30000} value={userZ[contourKey(selC)] ?? (selC.z ?? undefined)} placeholder="elevation" ariaLabel="Contour elevation, feet"
                    onValue={v => setUserZ(u => ({ ...u, [contourKey(selC)]: v }))}
                    className="w-24 rounded border border-navy-700 bg-navy-950 px-2 py-1 text-right" />
                  <span className="text-muted">ft</span>
                  {userZ[contourKey(selC)] !== undefined && (
                    <button className="min-h-[32px] rounded-md px-2 text-muted underline" onClick={() => setUserZ(u => { const n = { ...u }; delete n[contourKey(selC)]; return n })}>Undo mine</button>
                  )}
                  <button className="min-h-[32px] rounded-md px-2 text-muted underline"
                    onClick={() => setExcluded(x => { const n = { ...x }; const k = contourKey(selC); if (n[k]) delete n[k]; else n[k] = true; return n })}>
                    {shown?.out.has(selC.id) ? 'It is a contour' : 'Not a contour'}
                  </button>
                </div>
              )}
              <p className="text-faint">Pen: {(() => { const pn = pens.find(q => q.id === selC.pen); return pn ? `${pn.layer ?? 'no layer'} · ${pn.dash ? 'dashed' : 'solid'}` : '—' })()}</p>
            </div>
          )}

          {/* Number along a line */}
          {p.canEdit && (stats.eg.n > 0 || stats.fg.n > 0) && (
            <div className="space-y-2 rounded-lg border border-navy-800 p-2">
              {!lineForm ? (
                <button onClick={() => { setLineMsg(null); setLineForm({ role: stats.eg.named < stats.eg.n || stats.fg.n === 0 ? 'eg' : 'fg', z0: undefined, dz: read.interval.eg ?? read.interval.fg ?? 1, up: true }) }}
                  className="flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg bg-navy-800 px-2 hover:bg-navy-700">
                  <Ruler className="h-3.5 w-3.5" /> Number contours along a line
                </button>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={lineForm.role} onChange={e => setLineForm(f => f && { ...f, role: e.target.value as 'eg' | 'fg' })} className="rounded border border-navy-700 bg-navy-900 px-1 py-1">
                      <option value="eg">Existing</option><option value="fg">Proposed</option>
                    </select>
                    <span className="text-muted">first one crossed</span>
                    <NumField live step={0.5} min={-1500} max={30000} value={lineForm.z0} onValue={z0 => setLineForm(f => f && { ...f, z0 })} placeholder="ft" ariaLabel="First contour elevation"
                      className={`w-20 rounded border bg-navy-900 px-2 py-1 text-right ${lineForm.z0 === undefined ? 'border-amber/60' : 'border-navy-700'}`} />
                    <select value={lineForm.up ? 'up' : 'down'} onChange={e => setLineForm(f => f && { ...f, up: e.target.value === 'up' })} className="rounded border border-navy-700 bg-navy-900 px-1 py-1">
                      <option value="up">then up</option><option value="down">then down</option>
                    </select>
                    <NumField live step={0.25} min={0.1} max={100} value={lineForm.dz} onValue={dz => setLineForm(f => f && { ...f, dz })} ariaLabel="Contour interval"
                      className="w-14 rounded border border-navy-700 bg-navy-900 px-2 py-1 text-right" />
                    <span className="text-muted">ft</span>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={lineForm.z0 === undefined} onClick={() => p.onLineMode(true)} className="min-h-[36px] flex-1 rounded-lg bg-cyan-600/90 px-2 font-semibold text-navy-950 disabled:opacity-40">Draw the line on the map</button>
                    <button onClick={() => { setLineForm(null); p.onLineMode(false) }} className="min-h-[36px] rounded-lg px-2 text-muted hover:bg-navy-800">Cancel</button>
                  </div>
                  <p className="text-faint">Start on the contour whose elevation you typed and cross the others in order — they step by the interval. Labels already on the plan are kept and checked.</p>
                </div>
              )}
              {lineMsg && <p className={lastLine ? 'text-amber' : 'text-cyan-200'}>{lineMsg}</p>}
              {lastLine && lastLine.implied !== null && (
                <button onClick={() => runLine(lastLine.role, lastLine.pts, lastLine.implied as number, lastLine.dz)}
                  className="min-h-[36px] w-full rounded-lg border border-amber/60 px-2 text-amber hover:bg-amber/10">
                  The plan&apos;s labels make the first one {lastLine.implied}, not {lastLine.typed} — number from {lastLine.implied}
                </button>
              )}
            </div>
          )}

          {/* Pens */}
          <div className="space-y-1.5">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Linework</div>
            {[...contourPens, ...(allPens ? otherPens : [])].map(q => (
              <div key={q.id} className={`rounded-md border px-2 py-1.5 ${penShown === q.id ? 'border-cyan-400/70' : 'border-navy-800'}`}>
                <button className="flex w-full items-center gap-2 text-left" onClick={() => setPenShown(v => (v === q.id ? null : q.id))} title="Show this pen's lines on the map">
                  <span className="h-1 w-6 shrink-0 rounded" style={{ background: q.color, backgroundImage: q.dash ? 'repeating-linear-gradient(90deg, transparent 0 3px, #0b1622 3px 5px)' : undefined }} />
                  <span className="min-w-0 flex-1 truncate">{q.layer ?? 'No layer'} <span className="text-faint">· {q.dash ? 'dashed' : 'solid'} · {q.width} pt</span></span>
                  <span className="shrink-0 text-faint">{q.labels ? `${q.labels} labels` : `${Math.round(q.length / loaded.map.ptPerFt).toLocaleString()} ft`}</span>
                </button>
                {p.canEdit && (
                  <div className="mt-1 flex gap-1" role="radiogroup" aria-label={`What ${q.layer ?? 'this pen'} draws`}>
                    {(['eg', 'fg', 'none'] as Role[]).map(r => (
                      <button key={r} role="radio" aria-checked={(roles[q.id] ?? 'none') === r} onClick={() => setRole(q.id, r)}
                        className={`min-h-[30px] flex-1 rounded px-1 ${(roles[q.id] ?? 'none') === r ? 'bg-navy-700 font-semibold text-ink' : 'text-muted hover:bg-navy-800'}`}>
                        {ROLE_WORDS[r]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {otherPens.length > 0 && (
              <button onClick={() => setAllPens(v => !v)} className="min-h-[32px] text-cyan-300 underline">{allPens ? 'Hide the other linework' : `Show the other ${otherPens.length} pens (contours on an unusual layer?)`}</button>
            )}
          </div>

          {/* Import */}
          {p.canEdit && (
            <div className="space-y-2 rounded-lg border border-navy-800 p-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">Add to the takeoff</div>
              {stats.eg.named > 0 && <Check2 on={picks.egContours} set={v => setPicks(x => ({ ...x, egContours: v }))} text={`${stats.eg.named} existing contours${stats.eg.n > stats.eg.named ? ` (${stats.eg.n - stats.eg.named} without an elevation stay out)` : ''}`} />}
              {stats.fg.named > 0 && <Check2 on={picks.fgContours} set={v => setPicks(x => ({ ...x, fgContours: v }))} text={`${stats.fg.named} proposed contours${stats.fg.n > stats.fg.named ? ` (${stats.fg.n - stats.fg.named} without an elevation stay out)` : ''}`} />}
              {stats.egSpots > 0 && <Check2 on={picks.egSpots} set={v => setPicks(x => ({ ...x, egSpots: v }))} text={`${stats.egSpots} existing spot grades`} />}
              {stats.fgSpots > 0 && <Check2 on={picks.fgSpots} set={v => setPicks(x => ({ ...x, fgSpots: v }))} text={`${stats.fgSpots} proposed spot grades`} />}
              {read.pads.map((pd, i) => (
                <Check2 key={i} on={pd.outline && (picks.pads[i] ?? true)} disabled={!pd.outline} set={v => setPicks(x => ({ ...x, pads: { ...x.pads, [i]: v } }))}
                  text={pd.outline ? `Building pad, finished floor ${pd.ffe.toFixed(2)} (subgrade −8")` : `${pd.text} — no outline found; draw this pad by hand`} />
              ))}
              {read.limits && <Check2 on={picks.limits} set={v => setPicks(x => ({ ...x, limits: v }))} text="The limit of grading as the grading limits" />}
              {stats.eg.named > 0 && picks.egContours && (
                <Check2 on={useForExisting} set={setUseForExisting} text="Use the plan's existing contours for existing ground (instead of lidar)" />
              )}
              {!(stats.eg.named > 0 && picks.egContours && useForExisting) && read.datumFt !== null && Math.abs(read.datumFt) >= 0.05 && (
                <Check2 on={useDatum} set={setUseDatum} text={`Set the lidar datum offset to ${read.datumFt >= 0 ? '+' : '−'}${Math.abs(read.datumFt).toFixed(1)} ft`} />
              )}
              <button onClick={doImport} className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg bg-amber px-3 font-semibold text-navy-950 hover:brightness-110">
                <Check className="h-4 w-4" /> Add to the takeoff
              </button>
              {done && <p className="text-teal-200">{done}</p>}
              <p className="text-faint">Tap a contour on the map to fix its number or set it aside. White dashed = no elevation yet; a red edge = something to check.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Check2({ on, set, text, disabled }: { on: boolean; set: (v: boolean) => void; text: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-[28px] items-start gap-2 ${disabled ? 'opacity-60' : ''}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={e => set(e.target.checked)} className="mt-0.5 accent-amber" />
      <span>{text}</span>
    </label>
  )
}
