'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Compass, LocateFixed, Ruler, Crop as CropIcon, PencilRuler, FileDown, Pin, PinOff, Trash2, ChevronRight, X } from 'lucide-react'
import { PageCanvas, type PageSource, type Box, type Camera } from './PageCanvas'
import { loadPdfjs, type PdfDoc } from './pdf'
import { statusOf, revLabel, newestFirst, placementWords, type RoomVersion } from '@/lib/plans/room'
import { scaleVerdict, scaleWords, SCALE_LABEL, type ScaleCheck } from '@/lib/plans/scale'
import { pageUpBearing, uvOf, metresPerUnit, scGridConvergence, convergenceWords, type Corners4 } from '@/lib/plans/north'
import { composite, changeBoxes } from '@/lib/plans/compare'
import type { PlanImage, PlanSheetRow } from '@/lib/db/plans'
import { planPdfLinkAction, markPlanSeenAction, setSheetPinAction, deletePlanVersionAction, setVersionCropAction } from '@/lib/actions/plans'
import type { Crop } from '@/lib/plans/crop'
import type { PlanMark, TakeoffItem } from '@/lib/db/takeoff'
import { checksFor, measuringFeet } from '@/lib/plans/measure'
import { setVersionScaleAction, firstPassAction, suggestMarksAction } from '@/lib/actions/takeoff'
import { useMeasure } from './useMeasure'

const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// The PDFs this tab has open, last used last: three at most (a compare needs
// two), older ones closed — each holds a pdf.js worker. Pages load on demand
// by range request, so one sheet of a 50 MB set never downloads the set over
// a phone's data. The signed link lives 10 minutes: an open older than that
// gets a fresh link when a page it never fetched is asked for.
const MAX_DOCS = 3
const LINK_MS = 9 * 60_000
const docCache = new Map<string, { p: Promise<PdfDoc>; at: number }>()
function closeDoc(fileId: string) {
  const e = docCache.get(fileId)
  if (!e) return
  docCache.delete(fileId)
  // A minute's grace: a canvas still drawing from it finishes first.
  setTimeout(() => { void e.p.then((d) => d.loadingTask.destroy()).catch(() => {}) }, 60_000)
}
function openPdf(fileId: string, fresh = false): Promise<PdfDoc> {
  const hit = docCache.get(fileId)
  if (hit && !fresh) { docCache.delete(fileId); docCache.set(fileId, hit); return hit.p }
  if (hit) closeDoc(fileId)
  const p = (async () => {
    const r = await planPdfLinkAction(fileId)
    if (!r?.ok) throw new Error(r && !r.ok ? r.error : 'link')
    const pdfjs = await loadPdfjs()
    return await pdfjs.getDocument({ url: r.url, disableAutoFetch: true, disableStream: true }).promise as PdfDoc
  })()
  p.catch(() => { if (docCache.get(fileId)?.p === p) docCache.delete(fileId) })
  docCache.set(fileId, { p, at: Date.now() })
  while (docCache.size > MAX_DOCS) closeDoc(docCache.keys().next().value as string)
  return p
}
const linkStale = (fileId: string) => { const e = docCache.get(fileId); return !!e && Date.now() - e.at > LINK_MS }

interface Resolved { src: PageSource; w: number; h: number; note: string | null }

/** A version's page: the real PDF page when its file is here, else its picture. */
async function resolve(v: RoomVersion, img: PlanImage | undefined): Promise<Resolved> {
  if (v.fileId && v.page) {
    for (const fresh of [false, true]) {
      if (fresh && !linkStale(v.fileId)) break
      try {
        const doc = await openPdf(v.fileId, fresh)
        const page = await doc.getPage(v.page)
        const vp = page.getViewport({ scale: 1 })
        return { src: { kind: 'pdf', doc, page: v.page }, w: vp.width, h: vp.height, note: null }
      } catch { /* a stale link gets one fresh try, then the picture */ }
    }
  }
  if (!img) throw new Error('nothing to show')
  const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
    const i = new Image()
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight })
    i.onerror = () => rej(new Error('image'))
    i.src = img.url
  })
  return { src: { kind: 'image', url: img.url }, w: dims.w, h: dims.h, note: v.fileId ? 'Showing the picture — the PDF didn’t open.' : null }
}

/** Draw a version's page into an RGBA buffer of a given size (compare). */
async function pixelsOf(r: Resolved, pxW: number, pxH: number): Promise<Uint8ClampedArray> {
  const c = document.createElement('canvas')
  c.width = pxW; c.height = pxH
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pxW, pxH)
  if (r.src.kind === 'pdf') {
    const page = await r.src.doc.getPage(r.src.page)
    const vp = page.getViewport({ scale: pxW / r.w })
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise
  } else {
    const url = r.src.url
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('image'))
      i.src = url
    })
    ctx.drawImage(img, 0, 0, pxW, pxH)
  }
  const data = ctx.getImageData(0, 0, pxW, pxH).data
  c.width = 0; c.height = 0
  return data
}

/**
 * One sheet, every version (migration 143). It opens on the CURRENT version;
 * an older one wears a banner and a faint diagonal SUPERSEDED stamp so
 * nobody builds from it by mistake. Compare overlays two versions — old in
 * red, new in blue, unchanged dark — with clouds around what changed. North
 * up turns the sheet so north points up the way the map does (from where it
 * is placed); Plan up shows it as drawn. Where am I puts the phone's blue dot
 * on a placed sheet.
 */
export function SheetViewer({ zone, sheet, initialVersionId, images, sets, canEdit, canDelete = false, canPdf = true, items = [], marks = [], canCosts = false }: {
  zone: { id: string; name: string }
  sheet: PlanSheetRow
  initialVersionId: string
  images: Record<string, PlanImage>
  sets: { id: string; name: string; kind: string; issuedOn: string }[]
  canEdit: boolean
  /** Managers and above: delete a version. */
  canDelete?: boolean
  /** The original PDF (never for a prospect — pictures only). */
  canPdf?: boolean
  /** The company's item library (prices only when canCosts). */
  items?: TakeoffItem[]
  /** Every mark on this sheet's versions. */
  marks?: PlanMark[]
  canCosts?: boolean
}) {
  const router = useRouter()
  const versions = useMemo(() => [...sheet.versions].sort(newestFirst), [sheet.versions])
  const [vid, setVid] = useState(initialVersionId)
  const v = versions.find((x) => x.id === vid) ?? versions[0]
  const status = statusOf(v, sheet, versions)
  const img = v.imageId ? images[v.imageId] : undefined
  const setOf = (id: string | null) => sets.find((s) => s.id === id)

  const [res, setRes] = useState<Resolved | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setRes(null); setErr(null)
    resolve(canPdf ? v : { ...v, fileId: null }, img).then((r) => { if (alive) setRes(r) }).catch(() => { if (alive) setErr('This version has nothing to show.') })
    return () => { alive = false }
  }, [v, img, canPdf])

  // Opening the current version clears its NEW dot.
  useEffect(() => {
    if (status.kind === 'current') void markPlanSeenAction(sheet.id, v.id).catch(() => {})
  }, [sheet.id, v.id, status.kind])

  function pick(id: string) {
    setVid(id)
    setCmp(null)
    try { window.history.replaceState(null, '', `/plans/${zone.id}/${sheet.id}?v=${id}`) } catch { /* fine */ }
  }

  // ── North up / Plan up ──
  const bounds = img?.bounds as Corners4 | null | undefined
  const bearing = bounds ? pageUpBearing(bounds) : null
  const [northUp, setNorthUp] = useState(false)
  const rotation = northUp && bearing !== null ? bearing : 0
  const centre = bounds ? [(bounds[0][0] + bounds[2][0]) / 2, (bounds[0][1] + bounds[2][1]) / 2] as [number, number] : null
  const grid = centre ? scGridConvergence(centre[0], centre[1]) : null

  // ── Compare ──
  const [cmp, setCmp] = useState<string | null>(null)
  const [cmpCanvas, setCmpCanvas] = useState<HTMLCanvasElement | null>(null)
  const [clouds, setClouds] = useState<Box[]>([])
  const [ci, setCi] = useState(-1)
  const [cmpBusy, setCmpBusy] = useState(false)
  const other = cmp ? versions.find((x) => x.id === cmp) ?? null : null
  const pair = other ? [v, other].sort(newestFirst) : null // [newer, older]
  useEffect(() => {
    setCmpCanvas(null); setClouds([]); setCi(-1)
    if (!pair || !res) return
    let alive = true
    setCmpBusy(true)
    void (async () => {
      try {
        const [newer, older] = pair
        const rNew = newer.id === v.id ? res : await resolve(newer, newer.imageId ? images[newer.imageId] : undefined)
        const rOld = older.id === v.id ? res : await resolve(older, older.imageId ? images[older.imageId] : undefined)
        const touch = window.matchMedia?.('(pointer: coarse)').matches
        const L = touch ? 2048 : 3000
        const k = L / Math.max(rNew.w, rNew.h)
        const pxW = Math.max(1, Math.round(rNew.w * k)), pxH = Math.max(1, Math.round(rNew.h * k))
        const [a, b] = await Promise.all([pixelsOf(rOld, pxW, pxH), pixelsOf(rNew, pxW, pxH)])
        if (!alive) return
        const out = document.createElement('canvas')
        out.width = pxW; out.height = pxH
        const ctx = out.getContext('2d')
        if (!ctx) return
        const im = ctx.createImageData(pxW, pxH)
        composite(a, b, im.data)
        ctx.putImageData(im, 0, 0)
        // In the units of the page on the stage — the version being viewed,
        // which may be the older one (a picture in pixels against a PDF in points).
        const ux = res.w / pxW, uy = res.h / pxH
        const boxes = changeBoxes(a, b, pxW, pxH, Math.max(8, Math.round(pxW / 110)))
          .map((x) => ({ x0: x.x0 * ux, y0: x.y0 * uy, x1: x.x1 * ux, y1: x.y1 * uy }))
        setCmpCanvas(out); setClouds(boxes)
      } catch {
        if (alive) setErr('Compare needs both versions to open — one of them didn’t.')
      } finally {
        if (alive) setCmpBusy(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmp, res])
  const sameSize = !pair || !pair[0].pageW || !pair[1].pageW || (Math.abs((pair[0].pageW ?? 0) - (pair[1].pageW ?? 0)) <= 1 && Math.abs((pair[0].pageH ?? 0) - (pair[1].pageH ?? 0)) <= 1)

  // ── Where am I ──
  const [me, setMe] = useState<{ lng: number; lat: number; acc: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const watch = useRef<number | null>(null)
  const stopLocate = useCallback(() => {
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current)
    watch.current = null; setLocating(false); setMe(null)
  }, [])
  useEffect(() => stopLocate, [stopLocate])
  function startLocate() {
    if (!navigator.geolocation) { setErr('This device can’t share its location.'); return }
    setLocating(true)
    watch.current = navigator.geolocation.watchPosition(
      (p) => setMe({ lng: p.coords.longitude, lat: p.coords.latitude, acc: p.coords.accuracy }),
      () => { setErr('Location is off for HammerTrack — allow it to see yourself on the sheet.'); stopLocate() },
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
  }
  const dot = useMemo(() => {
    if (!me || !bounds || !res) return null
    const [u, vv] = uvOf(bounds, [me.lng, me.lat])
    const mpu = metresPerUnit(bounds, res.w)
    return { x: u * res.w, y: vv * res.h, r: mpu > 0 ? me.acc / mpu : 0, on: u >= 0 && u <= 1 && vv >= 0 && vv <= 1 }
  }, [me, bounds, res])

  // ── The scale card: the page's own evidence + where it sits on the map ──
  const [scaleOpen, setScaleOpen] = useState(false)
  const checks: ScaleCheck[] = useMemo(() => checksFor(v, bounds ?? null, placementWords(v.placement, true)), [v, bounds])
  // The same scale the server measures with (lib/takeoff-server.ts).
  const measuring = useMemo(() => measuringFeet(v, checks, bounds ?? null), [v, checks, bounds])
  const [scaleInput, setScaleInput] = useState('')
  async function setScale(fpi: number | null) {
    const r = await setVersionScaleAction(v.id, fpi).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setScaleInput('')
    router.refresh()
  }

  // ── Measuring (146) ──
  const [allMarks, setAllMarks] = useState<PlanMark[]>(marks)
  useEffect(() => { setAllMarks(marks) }, [marks])
  const prevVersionId = useMemo(() => {
    const i = versions.findIndex((x) => x.id === v.id)
    return i >= 0 && i + 1 < versions.length ? versions[i + 1].id : null
  }, [versions, v.id])
  // ── The first pass: which layer is which item (the AI, or the layer-name
  // rules), then the marks those layers draw, measured on the server and
  // left SUGGESTED until somebody accepts them (lib/plans/first-pass.ts).
  const [fp, setFp] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null })
  useEffect(() => { setFp({ busy: false, note: null }) }, [v.id])
  async function runFirstPass() {
    if (!res || res.src.kind !== 'pdf') return
    const src = res.src
    setFp({ busy: true, note: null })
    const done = (note: string) => setFp({ busy: false, note })
    try {
      const [{ readVectors }, FP] = await Promise.all([import('./pdf'), import('@/lib/plans/first-pass')])
      const pdfjs = await loadPdfjs()
      const vec = await readVectors(pdfjs, src.doc, src.page)
      const box = v.crop && v.crop.on !== false ? v.crop : null
      const lines = FP.inBox(vec.lines, vec.size, box)
      const stats = FP.penStats(vec.pens, lines)
      if (!stats.length) return done('No linework on this sheet — it may be a scan. Measure by hand.')
      const r = await firstPassAction(v.id, stats).catch(() => null)
      if (!r?.ok) return done(r && !r.ok ? r.error : 'The first pass didn’t answer — try again.')
      if (!r.assign.length) {
        return done(stats.some((s) => s.layer)
          ? 'None of this sheet’s layers matched an item in the library. Items named like the layers (curb, silt fence, 15" RCP…) get picked up.'
          : 'This PDF carries no CAD layer names, so the first pass can’t tell curb from contours. Measure by hand.')
      }
      const lib = items.map((it) => ({ id: it.id, code: it.code, name: it.name, measure: it.measure, section: it.section }))
      const penOf = new Map(vec.pens.map((p) => [p.id, p]))
      const { marks: proposed, dropped } = FP.proposeMarks(r.assign, lib, lines, vec.size, (a) => `First pass · ${penOf.get(a.pen)?.layer ?? `pen ${a.pen}`}`)
      if (!proposed.length) return done('The matched layers drew nothing measurable.')
      const saved = await suggestMarksAction(v.id, proposed).catch(() => null)
      if (!saved?.ok) return done(saved && !saved.ok ? saved.error : 'Couldn’t save the suggestions — try again.')
      setAllMarks((ms) => [...ms.filter((m) => !(m.versionId === v.id && m.status === 'suggested')), ...saved.marks])
      const nItems = new Set(saved.marks.map((m) => m.itemId)).size
      done(`${saved.marks.length} suggested mark${saved.marks.length === 1 ? '' : 's'} for ${nItems} item${nItems === 1 ? '' : 's'} from ${r.assign.length} layer${r.assign.length === 1 ? '' : 's'} (${r.source === 'ai' ? 'AI' : 'layer names'})${dropped ? ` · ${dropped} small pieces left out` : ''}. Dashed until you accept them — tap one to check it.`)
    } catch {
      done('The first pass couldn’t read this sheet.')
    }
  }
  const measure = useMeasure({
    versionId: v.id, prevVersionId, items, allMarks, setAllMarks, feet: measuring.feet, blocked: measuring.blocked,
    canEdit, canCosts, pageW: res?.w ?? 1, pageH: res?.h ?? 1,
    firstPass: res?.src.kind === 'pdf' ? { run: () => void runFirstPass(), busy: fp.busy, note: fp.note } : null,
  })
  const verdict = scaleVerdict(checks)
  const toneDot = verdict.tone === 'green' ? 'bg-emerald-400' : verdict.tone === 'red' ? 'bg-red-500' : verdict.tone === 'amber' ? 'bg-amber' : 'bg-navy-600'

  // ── Crop for the map: the drawing area that shows on the aerial ──
  const [cropEdit, setCropEdit] = useState(false)
  const [draft, setDraft] = useState<Crop>({ x0: 0, y0: 0, x1: 1, y1: 1 })
  const camRef = useRef<Camera | null>(null)
  const dragEdge = useRef<{ edge: 'x0' | 'y0' | 'x1' | 'y1'; sx: number; sy: number; start: Crop } | null>(null)
  function openCrop() {
    setDraft(v.crop && v.crop.on !== false ? { x0: v.crop.x0, y0: v.crop.y0, x1: v.crop.x1, y1: v.crop.y1 } : { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 })
    setCropEdit(true); setCmp(null)
  }
  async function saveCrop(on: boolean) {
    const r = await setVersionCropAction(v.id, { ...draft, on }).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    setCropEdit(false)
    router.refresh()
  }
  const edgeDown = (edge: 'x0' | 'y0' | 'x1' | 'y1') => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragEdge.current = { edge, sx: e.clientX, sy: e.clientY, start: draft }
  }
  const edgeMove = (e: React.PointerEvent) => {
    const d = dragEdge.current, cam = camRef.current
    if (!d || !cam?.s || !res) return
    e.stopPropagation()
    const a = (rotation * Math.PI) / 180
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    const du = ((dx * Math.cos(a) + dy * Math.sin(a)) / cam.s) / res.w
    const dv = ((-dx * Math.sin(a) + dy * Math.cos(a)) / cam.s) / res.h
    const n = { ...d.start }
    if (d.edge === 'x0') n.x0 = Math.min(n.x1 - 0.1, Math.max(0, d.start.x0 + du))
    if (d.edge === 'x1') n.x1 = Math.max(n.x0 + 0.1, Math.min(1, d.start.x1 + du))
    if (d.edge === 'y0') n.y0 = Math.min(n.y1 - 0.1, Math.max(0, d.start.y0 + dv))
    if (d.edge === 'y1') n.y1 = Math.max(n.y0 + 0.1, Math.min(1, d.start.y1 + dv))
    setDraft(n)
  }
  const edgeUp = (e: React.PointerEvent) => { e.stopPropagation(); dragEdge.current = null }

  const focus = ci >= 0 ? clouds[ci] ?? null : null
  const src = useMemo(() => res?.src ?? null, [res])

  async function pinIt(id: string | null) {
    const r = await setSheetPinAction(sheet.id, id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    router.refresh()
  }
  async function deleteIt() {
    if (!window.confirm(`Delete ${revLabel(v.rev)} of ${sheet.number}? ${versions.length === 1 ? 'It is the only version — the sheet goes too.' : 'The other versions stay.'}`)) return
    const r = await deletePlanVersionAction(v.id).catch(() => null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t delete — try again.'); return }
    if (versions.length === 1) router.push(`/plans/${zone.id}`)
    else { pick(versions.find((x) => x.id !== v.id)!.id); router.refresh() }
  }
  async function openPdfTab() {
    if (!v.fileId) return
    const r = await planPdfLinkAction(v.fileId).catch(() => null)
    if (r?.ok) window.open(r.url + (v.page ? `#page=${v.page}` : ''), '_blank', 'noopener')
    else setErr(r && !r.ok ? r.error : 'Couldn’t open the PDF.')
  }

  const overlay = (cam: Camera) => {
    if (!res) return null
    camRef.current = cam
    const W = res.w, H = res.h
    const hs = 14 / cam.s // handle size, constant on screen
    return (
      <>
        {cropEdit && (
          <svg className="absolute inset-0 overflow-visible" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
            <path fillRule="evenodd" fill="rgba(0,21,35,0.55)" pointerEvents="none"
              d={`M0,0H${W}V${H}H0Z M${draft.x0 * W},${draft.y0 * H}V${draft.y1 * H}H${draft.x1 * W}V${draft.y0 * H}Z`} />
            <rect x={draft.x0 * W} y={draft.y0 * H} width={(draft.x1 - draft.x0) * W} height={(draft.y1 - draft.y0) * H}
              fill="none" stroke="#2dd4bf" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            {([['x0', draft.x0 * W, (draft.y0 + draft.y1) / 2 * H], ['x1', draft.x1 * W, (draft.y0 + draft.y1) / 2 * H],
              ['y0', (draft.x0 + draft.x1) / 2 * W, draft.y0 * H], ['y1', (draft.x0 + draft.x1) / 2 * W, draft.y1 * H]] as const).map(([edge, x, y]) => (
              <rect key={edge} x={x - hs} y={y - hs} width={hs * 2} height={hs * 2} rx={hs * 0.4}
                fill="#2dd4bf" stroke="#001523" strokeWidth={2} vectorEffect="non-scaling-stroke"
                style={{ cursor: edge === 'x0' || edge === 'x1' ? 'ew-resize' : 'ns-resize', touchAction: 'none' }}
                onPointerDown={edgeDown(edge)} onPointerMove={edgeMove} onPointerUp={edgeUp} onPointerCancel={edgeUp} />
            ))}
          </svg>
        )}
        {!cmp && !cropEdit && measure.overlay(cam)}
        {status.kind !== 'current' && !cmp && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none overflow-hidden">
            <span className="font-display font-black text-red-600/20 whitespace-nowrap -rotate-[28deg] tracking-widest"
              style={{ fontSize: res.h * 0.13 }}>
              {status.kind === 'held' ? 'NOT CURRENT' : 'SUPERSEDED'}
            </span>
          </div>
        )}
        {cmp && clouds.length > 0 && (
          <svg className="absolute inset-0 pointer-events-none" width={res.w} height={res.h} viewBox={`0 0 ${res.w} ${res.h}`}>
            {clouds.map((b, i) => (
              <rect key={i} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={Math.min(b.x1 - b.x0, b.y1 - b.y0) * 0.2}
                fill="none" stroke={i === ci ? '#ff9e16' : '#e8870a'} strokeWidth={i === ci ? 3 : 1.6} strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        {dot?.on && (
          <svg className="absolute inset-0 pointer-events-none overflow-visible" width={res.w} height={res.h} viewBox={`0 0 ${res.w} ${res.h}`}>
            {dot.r > 0 && <circle cx={dot.x} cy={dot.y} r={dot.r} fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.5)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            <circle cx={dot.x} cy={dot.y} r={7 / cam.s} fill="#3b82f6" stroke="#fff" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </>
    )
  }

  return (
    <div className="h-full flex flex-col pb-[54px] md:pb-0">
      <div className="px-3 pt-3 pb-2 border-b border-navy-800 bg-navy-950 space-y-2">
        <div className="flex items-center gap-2">
          <Link href={`/plans/${zone.id}`} aria-label="Back to the plan room" className="rounded-lg p-1.5 text-muted hover:text-ink"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="min-w-0 flex-1">
            <p className="font-display font-bold text-ink truncate"><span className="font-mono">{sheet.number}</span> {sheet.title ? `· ${sheet.title}` : ''}</p>
            <p className="text-[11px] text-faint truncate">{zone.name} · {revLabel(v.rev)} · issued {fmtDay(v.issuedOn)}{setOf(v.setId) ? ` · ${setOf(v.setId)!.name}` : ''}{v.scaleText ? ` · ${v.scaleText}` : ''}</p>
            <p className={'text-[10.5px] truncate ' + (v.placement?.check ? 'text-amber' : 'text-faint')}>{placementWords(v.placement, !!bounds)}</p>
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
          {versions.map((x) => {
            const st = statusOf(x, sheet, versions)
            const on = x.id === v.id
            return (
              <button key={x.id} type="button" onClick={() => pick(x.id)}
                className={'flex-none rounded-lg border px-2.5 py-1 text-left ' + (on ? 'border-amber/70 bg-amber/10' : 'border-navy-700 hover:border-navy-600')}>
                <span className="block text-[12px] font-semibold text-ink whitespace-nowrap">{revLabel(x.rev)} <span className="text-faint font-normal">· {fmtDay(x.issuedOn)}</span></span>
                <span className={'block text-[10.5px] whitespace-nowrap ' + (st.kind === 'current' ? 'text-emerald-300' : st.kind === 'held' ? 'text-amber' : 'text-faint')}>
                  {st.kind === 'current' ? (st.pinned ? 'Current · pinned' : 'Current') : st.kind === 'held' ? 'Newer · held back' : `Superseded · ${revLabel(st.by.rev)}`}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {sheet.voidedAt && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/60 border-b border-red-900/60 text-[12.5px] text-red-200">
          VOID — a later set dropped this sheet ({fmtDay(sheet.voidedAt.slice(0, 10))}). Don’t build from it.
        </div>
      )}
      {status.kind !== 'current' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/60 border-b border-red-900/60 text-[12.5px]">
          <span className="flex-1 text-red-200">
            {status.kind === 'superseded'
              ? <>Superseded by {revLabel(status.by.rev)} ({fmtDay(status.by.issuedOn)}). Don’t build from this one.</>
              : <>Not current — {revLabel(status.current.rev)} is pinned as the current version.</>}
          </span>
          <button type="button" onClick={() => pick(sheet.currentId ?? versions[0].id)} className="rounded-lg bg-red-600 text-white font-semibold px-2.5 py-1 text-[12px]">Open current</button>
        </div>
      )}

      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-navy-800 bg-navy-950 overflow-x-auto text-[12px]">
        <button type="button" disabled={bearing === null} onClick={() => setNorthUp((x) => !x)}
          title={bearing === null ? 'Place the sheet on the map to know where north is' : undefined}
          className={'flex-none inline-flex items-center gap-1 rounded-lg border px-2 py-1 disabled:opacity-40 ' + (northUp ? 'border-teal/60 text-teal' : 'border-navy-700 text-muted')}>
          <Compass className="h-3.5 w-3.5" /> {northUp ? 'North up' : 'Plan up'}
        </button>
        {versions.length > 1 && (
          cmp ? (
            <button type="button" onClick={() => setCmp(null)} className="flex-none inline-flex items-center gap-1 rounded-lg border border-amber/60 text-amber px-2 py-1"><X className="h-3.5 w-3.5" /> End compare</button>
          ) : (
            <select aria-label="Compare with" value="" onChange={(e) => e.target.value && setCmp(e.target.value)}
              className="flex-none rounded-lg border border-navy-700 bg-navy-950 text-muted px-2 py-1">
              <option value="">Compare with…</option>
              {versions.filter((x) => x.id !== v.id).map((x) => <option key={x.id} value={x.id}>{revLabel(x.rev)} · {fmtDay(x.issuedOn)}</option>)}
            </select>
          )
        )}
        <button type="button" onClick={() => { measure.setOn(!measure.on); setCmp(null); setCropEdit(false) }} aria-pressed={measure.on}
          className={'flex-none inline-flex items-center gap-1 rounded-lg border px-2 py-1 ' + (measure.on ? 'border-amber/70 text-amber' : 'border-navy-700 text-muted')}>
          <PencilRuler className="h-3.5 w-3.5" /> Measure{measure.count ? ` · ${measure.count}` : ''}
        </button>
        <button type="button" onClick={() => setScaleOpen((x) => !x)} aria-expanded={scaleOpen}
          className={'flex-none inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 ' + (scaleOpen ? 'border-teal/60 text-teal' : 'border-navy-700 text-muted')}>
          <Ruler className="h-3.5 w-3.5" /> Scale <span className={'h-2 w-2 rounded-full ' + toneDot} />
        </button>
        {bounds && (
          <button type="button" onClick={() => (locating ? stopLocate() : startLocate())}
            className={'flex-none inline-flex items-center gap-1 rounded-lg border px-2 py-1 ' + (locating ? 'border-blue-400/60 text-blue-300' : 'border-navy-700 text-muted')}>
            <LocateFixed className="h-3.5 w-3.5" /> {locating ? (dot && !dot.on ? 'You’re off this sheet' : 'Where am I · on') : 'Where am I'}
          </button>
        )}
        {canEdit && bounds && !cmp && (
          <button type="button" onClick={() => (cropEdit ? setCropEdit(false) : openCrop())}
            className={'flex-none inline-flex items-center gap-1 rounded-lg border px-2 py-1 ' + (cropEdit ? 'border-teal/60 text-teal' : 'border-navy-700 text-muted')}>
            <CropIcon className="h-3.5 w-3.5" /> Map crop{v.crop && v.crop.on !== false ? ' · on' : ''}
          </button>
        )}
        {v.fileId && canPdf && <button type="button" onClick={() => void openPdfTab()} className="flex-none inline-flex items-center gap-1 rounded-lg border border-navy-700 text-muted px-2 py-1"><FileDown className="h-3.5 w-3.5" /> PDF</button>}
        {canEdit && status.kind !== 'current' && (
          <button type="button" onClick={() => void pinIt(v.id)} className="flex-none inline-flex items-center gap-1 rounded-lg border border-navy-700 text-muted px-2 py-1"><Pin className="h-3.5 w-3.5" /> Make current</button>
        )}
        {canEdit && status.kind === 'current' && status.pinned && (
          <button type="button" onClick={() => void pinIt(null)} className="flex-none inline-flex items-center gap-1 rounded-lg border border-navy-700 text-muted px-2 py-1"><PinOff className="h-3.5 w-3.5" /> Back to newest</button>
        )}
        {canDelete && <button type="button" onClick={() => void deleteIt()} aria-label="Delete this version" className="flex-none ml-auto rounded-lg p-1.5 text-faint hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>

      {measure.panel}

      {cropEdit && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-navy-900 border-b border-navy-800 text-[12px] flex-wrap">
          <span className="text-muted flex-1 min-w-[12rem]">Drag the teal edges to the drawing — the border and title block outside it hide on the map.</span>
          <button type="button" onClick={() => void saveCrop(false)} className="text-faint hover:text-ink">Use the whole sheet</button>
          <button type="button" onClick={() => setCropEdit(false)} className="text-faint hover:text-ink">Cancel</button>
          <button type="button" onClick={() => void saveCrop(true)} className="rounded-lg bg-amber text-[#1a1100] font-bold px-2.5 py-1">Save crop</button>
        </div>
      )}

      {scaleOpen && (
        <div className="px-3 py-2 bg-navy-900 border-b border-navy-800 text-[12px] space-y-1.5">
          <p className={verdict.tone === 'green' ? 'text-emerald-300 font-semibold' : verdict.tone === 'red' ? 'text-red-300 font-semibold' : verdict.tone === 'amber' ? 'text-amber font-semibold' : 'text-muted'}>{verdict.words}</p>
          {checks.length > 0 && (
            <table className="w-full text-left">
              <tbody>
                {checks.map((c) => (
                  <tr key={c.key} className="border-t border-navy-800">
                    <td className="py-1 pr-2 text-muted whitespace-nowrap">{SCALE_LABEL[c.key]}</td>
                    <td className="py-1 pr-2 font-mono text-ink whitespace-nowrap">{scaleWords(c.feetPerInch)}</td>
                    <td className="py-1 text-faint">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canEdit && !v.fileId && (
            <p className="text-[11px] text-faint">This version is a picture (no PDF), so its paper size is unknown: it measures from where it sits on the map. Place it to measure on it.</p>
          )}
          {canEdit && !!v.fileId && (
            <div className="flex items-center gap-2 flex-wrap">
              {verdict.suggest && <button type="button" onClick={() => void setScale(verdict.suggest!)} className="rounded-lg bg-amber text-[#1a1100] font-bold px-2.5 py-1">Use {scaleWords(verdict.suggest)}</button>}
              <span className="text-faint">Set the scale by hand: 1&quot; =</span>
              <input value={scaleInput} onChange={(e) => setScaleInput(e.target.value.replace(/[^0-9.]/g, '').slice(0, 7))} inputMode="decimal" aria-label="Feet per inch"
                className="w-16 rounded bg-navy-950 border border-navy-700 px-1.5 py-1 text-ink font-mono" placeholder="30" />
              <span className="text-faint">&apos;</span>
              <button type="button" disabled={!(Number(scaleInput) > 0)} onClick={() => void setScale(Number(scaleInput))} className="rounded-lg border border-navy-700 px-2 py-1 text-muted disabled:opacity-40">Use</button>
              {checks.some((c) => c.key === 'set') && <button type="button" onClick={() => void setScale(null)} className="text-faint underline">Clear the hand-set scale</button>}
            </div>
          )}
          <p className="text-[10.5px] text-faint">Green: two or more checks agree within 0.5 %. Amber: only one. Red: two disagree by more than 1 % — measuring stops until the scale is set.</p>
        </div>
      )}

      {cmp && pair && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-navy-900 border-b border-navy-800 text-[12px] flex-wrap">
          <span className="text-red-400 font-semibold">red = {revLabel(pair[1].rev)} (older)</span>
          <span className="text-blue-400 font-semibold">blue = {revLabel(pair[0].rev)} (newer)</span>
          <span className="text-faint">dark = unchanged</span>
          {!sameSize && <span className="text-amber">different paper — lined up by the page edges</span>}
          <span className="flex-1" />
          {cmpBusy ? <span className="text-faint">Comparing…</span> : clouds.length ? (
            <button type="button" onClick={() => setCi((i) => (i + 1) % clouds.length)} className="inline-flex items-center gap-1 rounded-lg bg-amber text-[#1a1100] font-bold px-2.5 py-1">
              Next change {ci >= 0 ? `${ci + 1} of ${clouds.length}` : `(${clouds.length})`} <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : <span className="text-faint">No drawn changes found</span>}
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        {res ? (
          <PageCanvas src={cmp ? null : src} base={cmp ? cmpCanvas : null} pageW={res.w} pageH={res.h} rotation={rotation} overlay={overlay} focus={focus}
            onTap={measure.on && !cmp && !cropEdit ? measure.onTap : undefined} drawing={measure.drawing && !cmp && !cropEdit} />
        ) : (
          <div className="h-full grid place-items-center text-sm text-faint">{err ?? 'Opening the sheet…'}</div>
        )}
        {res && bearing !== null && (
          <div className="absolute left-3 top-3 rounded-xl bg-navy-950/85 border border-navy-700 p-1.5 pointer-events-none" title="True north">
            <svg width="44" height="44" viewBox="-22 -22 44 44" aria-label="North arrow">
              <circle r="20" fill="none" stroke="#14506f" strokeWidth="1" />
              {grid !== null && Math.abs(grid) >= 0.05 && (
                <g transform={`rotate(${rotation - bearing + grid})`}>
                  <line x1="0" y1="-19" x2="0" y2="-11" stroke="#2dd4bf" strokeWidth="1.4" />
                </g>
              )}
              <g transform={`rotate(${rotation - bearing})`}>
                <text y="-12" textAnchor="middle" fontSize="8" fill="#e8f0f7" fontWeight="700">N</text>
                <path d="M0,-10 L5,9 L0,5 L-5,9 Z" fill="#e8f0f7" />
                <path d="M0,-10 L0,5 L-5,9 Z" fill="#9fb6cc" />
              </g>
            </svg>
          </div>
        )}
        {res?.note && <p className="absolute left-3 bottom-3 rounded bg-navy-950/85 px-2 py-1 text-[11px] text-amber">{res.note}</p>}
        {err && res && <p className="absolute left-1/2 -translate-x-1/2 top-3 rounded bg-navy-950/90 px-2.5 py-1 text-[12px] text-red-300">{err}</p>}
      </div>
      {res && bearing !== null && grid !== null && (
        <p className="px-3 py-1 text-[10.5px] text-faint bg-navy-950 border-t border-navy-800">
          North arrow: true north from where the sheet is placed{northUp ? ' — the sheet is turned so north is up' : ''}. Grid north (SC State Plane, teal tick) is {convergenceWords(grid)} here.
        </p>
      )}
    </div>
  )
}

