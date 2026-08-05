'use client'

import { useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { FileText, Trash2, MapPin } from 'lucide-react'
import {
  createImageryUploadAction, finalizeZoneImageryAction, deleteZoneImageryAction,
  setActivePlanAction, type ZoneImage,
} from '@/lib/actions/imagery'
import { createClient } from '@/lib/supabase'
import type { Corners } from '@/components/geofences/OverlayPlacer'

const OverlayPlacer = dynamic(
  () => import('@/components/geofences/OverlayPlacer').then((m) => ({ default: m.OverlayPlacer })),
  { ssr: false }
)

// Keep in sync with PLAN_CATEGORIES in lib/actions/imagery.ts.
const CATEGORIES = ['Existing', 'Site plan', 'Utilities', 'Grading', 'Landscape', 'Erosion control', 'Other']

/** Rasterize one PDF page to a PNG blob in the browser (pdf.js). */
async function rasterizePdfPage(file: File, pageNum: number): Promise<Blob> {
  // pdf.js is served from /public and loaded with a NATIVE dynamic import —
  // webpack cannot parse its bundles (build fails), so it must never see
  // them. The files under public/pdfjs/ are copies of
  // node_modules/pdfjs-dist/legacy/build/ — refresh them on version bumps.
  const pdfjs = await import(/* webpackIgnore: true */ '/pdfjs/pdf.min.mjs' as string) as typeof import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const page = await doc.getPage(Math.min(Math.max(1, pageNum), doc.numPages))
  const base = page.getViewport({ scale: 1 })
  // ~3000px on the long edge keeps dimension text legible without blowing
  // the upload cap; plan sheets compress well as PNG line art.
  const scale = Math.min(6, 3000 / Math.max(base.width, base.height))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('rasterize failed')
  return blob
}

/**
 * Scaled Plans — plan sheets (PDF or image) placed on the site like aerials.
 * Categories act as a radio: exactly one sheet per zone can be "on the map",
 * shown on /map under the Scaled plans layer toggle. Sheets from one plan set
 * share the site's frame — place the first, and reuse its footprint by eye.
 */
export function ZonePlans({ zoneId, initial, canEdit, ring = null }: {
  zoneId: string
  initial: ZoneImage[]
  canEdit: boolean
  ring?: [number, number][] | null
}) {
  const [plans, setPlans] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [category, setCategory] = useState('Site plan')
  const [pdfPage, setPdfPage] = useState(1)
  const [placing, setPlacing] = useState<ZoneImage | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload() {
    const f = fileRef.current?.files?.[0]
    if (!f) { setError('Attach the plan first (PDF or image).'); return }
    setBusy(true); setError(null)
    let payload: Blob = f
    let type = f.type || 'application/octet-stream'
    if (type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      try {
        payload = await rasterizePdfPage(f, pdfPage)
        type = 'image/png'
      } catch {
        setBusy(false)
        setError('Couldn’t read that PDF — export the sheet as a PNG/JPEG and upload that instead.')
        return
      }
    }
    if (!type.startsWith('image/')) { setBusy(false); setError('That file isn’t a PDF or image.'); return }
    if (payload.size > 50 * 1024 * 1024) { setBusy(false); setError('Sheet too large (50 MB max after conversion).'); return }

    const pre = await createImageryUploadAction(zoneId, type, payload.size).catch(() => null)
    if (!pre?.ok || !pre.path || !pre.token) {
      setBusy(false); setError(pre?.error ?? 'Upload didn’t go through — check signal and try again.'); return
    }
    const { error: upErr } = await createClient().storage.from('field-photos')
      .uploadToSignedUrl(pre.path, pre.token, payload, { contentType: type })
    if (upErr) { setBusy(false); setError('Upload didn’t go through — check signal and try again.'); return }
    const r = await finalizeZoneImageryAction({
      zoneId, path: pre.path,
      takenOn: new Date().toISOString().slice(0, 10),
      caption: f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 120),
      kind: 'plan', planCategory: category,
    }).catch(() => null)
    setBusy(false)
    if (r?.ok && r.image) {
      setPlans((xs) => [r.image!, ...xs])
      setShowUpload(false)
      if (fileRef.current) fileRef.current.value = ''
      setPlacing(r.image) // a plan is useless until it's on the ground — place now
    } else setError(r?.error ?? 'Upload didn’t go through — check signal and try again.')
  }

  async function setActive(id: string | null) {
    const prev = plans
    setPlans((xs) => xs.map((p) => ({ ...p, map_active: p.id === id })))
    const r = await setActivePlanAction(zoneId, id).catch(() => null)
    if (!r?.ok) { setPlans(prev); setError(r?.error ?? 'Couldn’t update — try again.') }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5 flex-1">
          <FileText className="h-3.5 w-3.5" /> Scaled plans
          {plans.length > 0 && <span className="normal-case tracking-normal">· {plans.length} sheet{plans.length === 1 ? '' : 's'}</span>}
        </h2>
        {canEdit && (
          <button type="button" onClick={() => setShowUpload((s) => !s)}
            className="rounded-lg bg-navy-800 border border-navy-700 text-muted hover:text-ink text-[11px] font-semibold px-2.5 py-1">
            + Add sheet
          </button>
        )}
      </div>

      {showUpload && (
        <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 mb-2 flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf,image/*"
            className="text-[11.5px] text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-navy-700 file:text-ink file:px-2.5 file:py-1.5 file:text-xs" />
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-ink">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="text-[11px] text-muted flex items-center gap-1.5">
            PDF page
            <input type="number" min={1} value={pdfPage} onChange={(e) => setPdfPage(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-ink" />
          </label>
          <button type="button" disabled={busy} onClick={upload}
            className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5 disabled:opacity-40">
            {busy ? 'Converting…' : 'Save'}
          </button>
          <p className="w-full text-[10.5px] text-faint">
            PDF sheets convert to an image, then you scale + rotate them onto the site — same as placing a drone shot.
          </p>
        </div>
      )}

      {plans.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No plan sheets yet. Add the siteplan, utilities, or grading sheet as a PDF —
          it converts to an overlay you scale and rotate onto the real site.
        </p>
      ) : (
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
              <img src={p.url} alt="" loading="lazy" className="h-10 w-14 object-cover rounded border border-navy-700 bg-white" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-ink truncate">{p.plan_category ?? 'Plan'}</p>
                {p.caption && <p className="text-[10.5px] text-faint truncate">{p.caption}</p>}
              </div>
              {canEdit && (
                <button type="button"
                  onClick={() => setPlacing(p)}
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
          hint="Line the sheet’s property corners up with the satellite view — the drawn scale carries over."
          onClose={() => setPlacing(null)}
          onSaved={(b) => {
            setPlans((xs) => xs.map((x) => (x.id === placing.id ? { ...x, bounds: b, map_active: b ? x.map_active : false } : x)))
            setPlacing(null)
          }}
        />
      )}
    </section>
  )
}
