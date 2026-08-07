'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { FileText, Trash2, MapPin } from 'lucide-react'
import {
  createImageryUploadAction, finalizeZoneImageryAction, deleteZoneImageryAction,
  setActivePlanAction, saveOverlayBoundsAction, type ZoneImage,
} from '@/lib/actions/imagery'
import { createClient } from '@/lib/supabase'
import { busy as globalBusy } from '@/lib/busy'
import { thumbUrl, fallbackToRaw } from '@/lib/img'
import type { Corners } from '@/components/zones/OverlayPlacer'

const OverlayPlacer = dynamic(
  () => import('@/components/zones/OverlayPlacer').then((m) => ({ default: m.OverlayPlacer })),
  { ssr: false }
)

// Keep in sync with PLAN_CATEGORIES in lib/actions/imagery.ts.
const CATEGORIES = ['Site plan', 'Existing', 'Utilities', 'Grading', 'Landscape', 'Erosion control', 'Other']

type PdfjsModule = typeof import('pdfjs-dist')
type PdfDoc = import('pdfjs-dist').PDFDocumentProxy

/** pdf.js is served from /public with a NATIVE dynamic import — webpack can't
 *  parse its bundles (build breaks), so it must never see them. The files
 *  under public/pdfjs/ mirror node_modules/pdfjs-dist/legacy/build/. */
async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = await import(/* webpackIgnore: true */ '/pdfjs/pdf.min.mjs' as string) as PdfjsModule
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
  return pdfjs
}

async function renderPage(doc: PdfDoc, pageNum: number, longEdgePx: number, asBlob: boolean): Promise<Blob | string> {
  const page = await doc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(6, longEdgePx / Math.max(base.width, base.height))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
  // Free the page's decoded resources immediately — sheets with embedded
  // aerials hold 100+ MP bitmaps, and iPad Safari crash-reloads the tab when
  // peak memory spikes ("page refreshes mid-import", Aug 7).
  page.cleanup()
  if (!asBlob) {
    const url = canvas.toDataURL('image/jpeg', 0.7)
    canvas.width = 0; canvas.height = 0
    return url
  }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  canvas.width = 0; canvas.height = 0
  if (!blob) throw new Error('rasterize failed')
  return blob
}

/**
 * Scaled Plans — plan sheets placed on the site like aerials. Full-planset
 * import (owner ask, Aug 6): pick a PDF, check the sheets you want, name
 * each one, and place ONCE — civil sets share scale/orientation/title-block,
 * so the first sheet's placement is stamped onto every sheet in the batch.
 * Exactly one sheet per zone shows on the live map (radio → Scaled plans
 * layer).
 */
export function ZonePlans({ zoneId, initial, canEdit, ring = null }: {
  zoneId: string
  initial: ZoneImage[]
  canEdit: boolean
  ring?: [number, number][] | null
}) {
  const [plans, setPlans] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'picking' | 'importing'>('idle')
  const [progress, setProgress] = useState('')
  const [thumbs, setThumbs] = useState<string[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [sel, setSel] = useState<Record<number, string>>({}) // page → category
  const [placing, setPlacing] = useState<ZoneImage | null>(null)
  // Sheets uploaded in the same batch as `placing` — the saved placement is
  // stamped onto all of them.
  const batchRest = useRef<ZoneImage[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<PdfDoc | null>(null)
  const fileNameRef = useRef('')

  const resetPicker = () => {
    setPhase('idle'); setThumbs([]); setSel({}); setPageCount(0); setProgress('')
    ;(docRef.current as unknown as { destroy?: () => Promise<void> })?.destroy?.().catch(() => {})
    docRef.current = null
    if (fileRef.current) fileRef.current.value = ''
  }

  async function onFilePicked() {
    const f = fileRef.current?.files?.[0]
    if (!f) return
    setError(null)
    fileNameRef.current = f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 100)
    if (!(f.type === 'application/pdf' || /\.pdf$/i.test(f.name))) {
      // Plain image → single-sheet path, straight to upload.
      await importBlobs([{ blob: f, category: 'Site plan', label: fileNameRef.current }])
      return
    }
    setPhase('loading')
    const done = globalBusy(`Reading ${f.name.slice(0, 40)}…`)
    try {
      const pdfjs = await loadPdfjs()
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise as PdfDoc
      docRef.current = doc
      setPageCount(doc.numPages)
      setPhase('picking')
      // Thumbnails render sequentially so a 40-sheet set doesn't blow memory.
      for (let i = 1; i <= doc.numPages; i++) {
        const url = await renderPage(doc, i, 220, false) as string
        setThumbs((prev) => [...prev, url])
      }
    } catch {
      resetPicker()
      setError('Couldn’t read that PDF — export the sheets as images and upload those instead.')
    } finally {
      done()
    }
  }

  /** Upload one sheet. fatal=true means stop the batch (network/server
   *  trouble); fatal=false means this sheet was skipped, keep going. */
  async function uploadOne(blob: Blob, category: string, label: string): Promise<{ img?: ZoneImage; fatal?: boolean }> {
    const type = blob.type || 'image/png'
    if (blob.size > 50 * 1024 * 1024) { setError(`"${label}" is over 50 MB — skipped.`); return {} }
    const pre = await createImageryUploadAction(zoneId, type, blob.size).catch(() => null)
    if (!pre?.ok || !pre.path || !pre.token) { setError(pre?.error ?? 'Upload didn’t go through — check signal and try again.'); return { fatal: true } }
    const { error: upErr } = await createClient().storage.from('field-photos')
      .uploadToSignedUrl(pre.path, pre.token, blob, { contentType: type })
    if (upErr) { setError('Upload didn’t go through — check signal and try again.'); return { fatal: true } }
    const r = await finalizeZoneImageryAction({
      zoneId, path: pre.path,
      takenOn: new Date().toISOString().slice(0, 10),
      caption: label, kind: 'plan', planCategory: category,
    }).catch(() => null)
    if (r?.ok && r.image) return { img: r.image }
    setError(r?.error ?? 'Upload didn’t go through — check signal and try again.')
    return { fatal: true }
  }

  /** Hand the uploaded batch off to placement (first sheet places, the rest
   *  inherit its corners on save). */
  function finishBatch(uploaded: ZoneImage[]) {
    resetPicker()
    if (!uploaded.length) return
    setPlans((xs) => [...uploaded, ...xs])
    batchRest.current = uploaded.slice(1)
    setPlacing(uploaded[0])
  }

  // Convert → upload ONE sheet at a time, never the whole set: holding every
  // full-res blob at once (the old flow) blew iPad Safari's memory ceiling on
  // big plansets and the tab crash-reloaded mid-import ("page refreshes and
  // it doesn't allow an upload", Aug 7 — coroner's office set).
  async function importSelected() {
    const doc = docRef.current
    const pages = Object.keys(sel).map(Number).sort((a, b) => a - b)
    if (!doc || pages.length === 0) { setError('Check at least one sheet.'); return }
    setPhase('importing'); setError(null)
    setThumbs([]) // free the picker thumbnails before the heavy work
    const uploaded: ZoneImage[] = []
    for (let i = 0; i < pages.length; i++) {
      const converting = `Sheet ${i + 1} of ${pages.length} — converting…`
      setProgress(converting)
      const dConv = globalBusy(converting)
      let blob: Blob
      try {
        blob = await renderPage(doc, pages[i], 3000, true) as Blob
      } catch {
        setError(`Page ${pages[i]} wouldn’t convert — skipped.`)
        continue
      } finally {
        dConv()
      }
      const uploading = `Sheet ${i + 1} of ${pages.length} — uploading…`
      setProgress(uploading)
      const dUp = globalBusy(uploading)
      try {
        const res = await uploadOne(blob, sel[pages[i]], `${fileNameRef.current} — p${pages[i]}`)
        if (res.img) uploaded.push(res.img)
        else if (res.fatal) break
      } finally {
        dUp()
      }
    }
    finishBatch(uploaded)
  }

  async function importBlobs(items: { blob: Blob; category: string; label: string }[]) {
    if (!items.length) { resetPicker(); return }
    setPhase('importing')
    const uploaded: ZoneImage[] = []
    for (let i = 0; i < items.length; i++) {
      const label = `Uploading sheet ${i + 1} of ${items.length}…`
      setProgress(label)
      const done = globalBusy(label)
      try {
        const res = await uploadOne(items[i].blob, items[i].category, items[i].label)
        if (res.img) uploaded.push(res.img)
        else if (res.fatal) break
      } finally {
        done()
      }
    }
    finishBatch(uploaded)
  }

  async function setActive(id: string | null) {
    const prev = plans
    setPlans((xs) => xs.map((p) => ({ ...p, map_active: p.id === id })))
    const r = await setActivePlanAction(zoneId, id).catch(() => null)
    if (!r?.ok) { setPlans(prev); setError(r?.error ?? 'Couldn’t update — try again.') }
  }

  const busy = phase === 'loading' || phase === 'importing'

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5 flex-1">
          <FileText className="h-3.5 w-3.5" /> Scaled plans
          {plans.length > 0 && <span className="normal-case tracking-normal">· {plans.length} sheet{plans.length === 1 ? '' : 's'}</span>}
        </h2>
        {canEdit && phase === 'idle' && (
          <label className="rounded-lg bg-navy-800 border border-navy-700 text-muted hover:text-ink text-[11px] font-semibold px-2.5 py-1 cursor-pointer">
            + Add planset
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={onFilePicked} />
          </label>
        )}
      </div>

      {phase === 'loading' && (
        <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 mb-2">
          <div className="h-[3px] rounded-full bg-navy-800 overflow-hidden mb-2">
            <div className="h-full w-1/3 rounded-full bg-teal/80 animate-tl-sweep" />
          </div>
          <p className="text-[11.5px] text-faint">Reading the planset…</p>
        </div>
      )}

      {phase === 'picking' && (
        <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 mb-2">
          <p className="text-[11.5px] text-muted mb-2">
            <b className="text-ink">{pageCount} page{pageCount === 1 ? '' : 's'}</b> — check the sheets to import and name each one.
            You’ll place the first sheet once; every sheet in this batch gets the same scale, rotation and position.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((pg) => {
              const checked = pg in sel
              return (
                <div key={pg} className={'rounded-lg border p-1.5 ' + (checked ? 'border-teal/60 bg-teal/5' : 'border-navy-700')}>
                  <button type="button" className="relative w-full" onClick={() => {
                    setSel((s) => {
                      const next = { ...s }
                      if (checked) delete next[pg]
                      else next[pg] = 'Site plan'
                      return next
                    })
                  }}>
                    {thumbs[pg - 1]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={thumbs[pg - 1]} alt={`Page ${pg}`} className="w-full rounded bg-white" />
                      : <div className="w-full aspect-[4/3] rounded bg-navy-800 animate-pulse" />}
                    <span className={'absolute top-1 left-1 grid place-items-center w-5 h-5 rounded text-[10px] font-bold ' + (checked ? 'bg-teal text-navy-950' : 'bg-navy-950/80 text-faint border border-navy-600')}>
                      {checked ? '✓' : pg}
                    </span>
                  </button>
                  {checked && (
                    <select value={sel[pg]} onChange={(e) => setSel((s) => ({ ...s, [pg]: e.target.value }))}
                      className="mt-1 w-full rounded bg-navy-950 border border-navy-700 px-1 py-1 text-[10.5px] text-ink">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button type="button" disabled={busy || Object.keys(sel).length === 0} onClick={importSelected}
              className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5 disabled:opacity-40">
              Import {Object.keys(sel).length || ''} sheet{Object.keys(sel).length === 1 ? '' : 's'}
            </button>
            <button type="button" onClick={resetPicker} className="text-xs text-faint hover:text-ink">Cancel</button>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 mb-2">
          <div className="h-[3px] rounded-full bg-navy-800 overflow-hidden mb-2">
            <div className="h-full w-1/3 rounded-full bg-teal/80 animate-tl-sweep" />
          </div>
          <p className="text-[11.5px] text-faint">{progress}</p>
        </div>
      )}

      {plans.length === 0 && phase === 'idle' ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No plan sheets yet. Add the whole planset PDF — pick the sheets you want
          (siteplan, utilities, grading…), place the first one, and the rest line up automatically.
        </p>
      ) : plans.length > 0 && (
        <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
          {canEdit && (
            <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer">
              <input type="radio" name={`plan-active-${zoneId}`} className="accent-amber"
                checked={!plans.some((p) => p.map_active)} onChange={() => setActive(null)} />
              <span className="text-[11.5px] text-faint">None on map</span>
            </label>
          )}
          {plans.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 px-3 py-2">
              {canEdit && (
                <input type="radio" name={`plan-active-${zoneId}`} className="accent-amber disabled:opacity-30"
                  checked={!!p.map_active} disabled={!p.bounds}
                  onChange={() => setActive(p.id)}
                  title={p.bounds ? 'Show this sheet on the live map' : 'Place it on the map first'} />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbUrl(p.url, 160)} onError={(e) => fallbackToRaw(e, p.url)} alt="" loading="lazy" className="h-10 w-14 object-cover rounded border border-navy-700 bg-white" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-ink truncate">{p.plan_category ?? 'Plan'}</p>
                {p.caption && <p className="text-[10.5px] text-faint truncate">{p.caption}</p>}
              </div>
              {canEdit && (
                <button type="button"
                  onClick={() => { batchRest.current = []; setPlacing(p) }}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-semibold ${
                    p.bounds ? 'border-teal/50 text-teal' : 'border-navy-700 text-muted hover:text-ink'
                  }`}>
                  <MapPin className="h-3 w-3" /> {p.bounds ? 'Placed ✓' : 'Place on map'}
                </button>
              )}
              {canEdit && (
                <button type="button" aria-label="Delete this sheet"
                  onClick={() => {
                    setPlans((xs) => xs.filter((x) => x.id !== p.id))
                    deleteZoneImageryAction(zoneId, p.id)
                  }}
                  className="rounded-lg border border-navy-700 p-1 text-faint hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-400 mt-1">{error}</p>}
      {placing && (
        <OverlayPlacer
          zoneId={zoneId}
          imageId={placing.id}
          imageUrl={placing.url}
          ring={ring}
          initialBounds={(placing.bounds ?? null) as Corners | null}
          hint={batchRest.current.length > 0
            ? `Place this sheet — the other ${batchRest.current.length} in this batch will copy the same placement.`
            : 'Line the sheet’s property corners up with the satellite view — the drawn scale carries over.'}
          onClose={() => { batchRest.current = []; setPlacing(null) }}
          onSaved={async (b) => {
            const rest = batchRest.current
            batchRest.current = []
            const ids = new Set([placing.id, ...rest.map((r) => r.id)])
            setPlans((xs) => xs.map((x) => (ids.has(x.id) ? { ...x, bounds: b, map_active: b ? x.map_active : false } : x)))
            setPlacing(null)
            // Stamp the batch: same corners for every sheet in the set. This
            // ran dead silent and read as a frozen page ("it froze", Aug 7) —
            // every copy now announces itself on the global BusyBar.
            if (b) {
              for (let i = 0; i < rest.length; i++) {
                const done = globalBusy(`Copying placement — sheet ${i + 2} of ${rest.length + 1}…`)
                try {
                  await saveOverlayBoundsAction(zoneId, rest[i].id, b).catch(() => null)
                } finally {
                  done()
                }
              }
            }
          }}
        />
      )}
    </section>
  )
}
