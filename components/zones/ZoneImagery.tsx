'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { Camera, Trash2, ChevronLeft, ChevronRight, MapPin, Maximize2 } from 'lucide-react'
import { PhotoLightbox } from '@/components/zones/PhotoLightbox'
import { createImageryUploadAction, finalizeZoneImageryAction, deleteZoneImageryAction, type ZoneImage } from '@/lib/actions/imagery'
import { createClient } from '@/lib/supabase'
import { busy as globalBusy } from '@/lib/busy'
import { thumbUrl, fallbackToRaw } from '@/lib/img'
import type { Corners } from '@/components/zones/OverlayPlacer'

// MapLibre needs the browser — load the placer only when opened.
const OverlayPlacer = dynamic(
  () => import('@/components/zones/OverlayPlacer').then((m) => ({ default: m.OverlayPlacer })),
  { ssr: false }
)

const SOURCE_LABEL: Record<ZoneImage['source'], string> = {
  drone: '🛩 drone', aerial: '✈ aerial', satellite: '🛰 satellite', ground: '📷 ground',
}

/**
 * Site imagery — the job's visual evidence locker. Dated photos (Brian's
 * Mavic flies daily) on a time slider: pick a date, see the site that day.
 * Feeds the closeout binder and pay-app proof; the before/after IS the
 * dispute defense.
 */
export function ZoneImagery({ zoneId, initial, canEdit, ring = null }: {
  zoneId: string
  initial: ZoneImage[]
  canEdit: boolean
  /** Zone ring ([lng,lat][]) — reference outline + framing for "Place on map". */
  ring?: [number, number][] | null
}) {
  const [images, setImages] = useState(initial)
  const [idx, setIdx] = useState(0) // index into DATES (newest first)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [placing, setPlacing] = useState<ZoneImage | null>(null)
  const [viewing, setViewing] = useState<ZoneImage | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [takenOn, setTakenOn] = useState(new Date().toISOString().slice(0, 10))
  // Preview of the picked file with the date it was TAKEN (EXIF) — a gallery
  // photo from three days ago must not silently land on today's date.
  const [preview, setPreview] = useState<{ url: string; note: string; exact: boolean } | null>(null)

  async function onPickFile() {
    const f = fileRef.current?.files?.[0]
    setPreview((p) => { if (p) URL.revokeObjectURL(p.url); return null })
    if (!f) return
    const url = URL.createObjectURL(f)
    const today = new Date().toISOString().slice(0, 10)
    const meta = await import('@/lib/drone-meta').then((m) => m.photoTakenOn(f)).catch(() => null)
    if (meta) {
      const date = meta.date > today ? today : meta.date
      setTakenOn(date)
      const label = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      setPreview({
        url,
        note: meta.from === 'photo' ? `Taken ${label}` : `${label} (from the file — confirm below)`,
        exact: meta.from === 'photo',
      })
    } else {
      setPreview({ url, note: 'No date in this photo — set it below', exact: false })
    }
  }
  const [caption, setCaption] = useState('')
  // '90° top-down drone' shots become map overlays (auto pre-placed from the
  // drone's EXIF/XMP when present); 'site photo' stays timeline-only.
  const [viewType, setViewType] = useState<'drone' | 'ground'>('drone')
  const [smartHint, setSmartHint] = useState<string | null>(null)
  const [, start] = useTransition()

  // Group by capture date, newest first — the slider steps DATES, and a date
  // can hold several shots (angles) shown as a strip.
  const dates = useMemo(() => {
    const m = new Map<string, ZoneImage[]>()
    for (const im of images) {
      const list = m.get(im.taken_on) ?? []
      list.push(im)
      m.set(im.taken_on, list)
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [images])
  const current = dates[Math.min(idx, Math.max(0, dates.length - 1))]
  const [shot, setShot] = useState(0)
  const fmt = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  async function upload() {
    const f = fileRef.current?.files?.[0]
    if (!f) { setError('Attach the photo first.'); return }
    if (f.size > 50 * 1024 * 1024) {
      setError(`Photo is ${(f.size / 1024 / 1024).toFixed(1)} MB — 50 MB max. Export a smaller file and retry.`)
      return
    }
    setBusy(true); setError(null)
    const done = globalBusy(`Uploading ${viewType === 'drone' ? 'drone shot' : 'site photo'} (${(f.size / 1024 / 1024).toFixed(1)} MB)…`)
    const type = f.type || 'image/jpeg'
    // Three steps so the file itself never rides through a server action
    // (Vercel caps those request bodies): mint a signed URL, stream the photo
    // straight to storage, then record it. .catch(null) — never crash on r.ok.
    const pre = await createImageryUploadAction(zoneId, type, f.size).catch(() => null)
    if (!pre?.ok || !pre.path || !pre.token) {
      setBusy(false); done(); setError(pre?.error ?? 'Upload didn’t go through — check signal and try again.'); return
    }
    const { error: upErr } = await createClient().storage.from('field-photos')
      .uploadToSignedUrl(pre.path, pre.token, f, { contentType: type })
    if (upErr) {
      setBusy(false); done(); setError('Upload didn’t go through — check signal and try again.'); return
    }
    const r = await finalizeZoneImageryAction({ zoneId, path: pre.path, takenOn, caption, source: viewType }).catch(() => null)
    setBusy(false); done()
    if (r?.ok && r.image) {
      setImages((xs) => [r.image!, ...xs])
      setIdx(0); setShot(0); setCaption(''); setShowUpload(false)
      if (fileRef.current) fileRef.current.value = ''
      setPreview((p) => { if (p) URL.revokeObjectURL(p.url); return null })
      // Smart placement (drone shots): read GPS + gimbal yaw + altitude from
      // the file's EXIF/XMP and open the placer pre-positioned — nudge + Save.
      if (viewType === 'drone') {
        const { droneShotCorners } = await import('@/lib/drone-meta')
        const corners = await droneShotCorners(f)
        setSmartHint(corners
          ? 'Pre-placed from the drone’s flight data — nudge if needed, then Save.'
          : null)
        setPlacing({ ...r.image, bounds: corners ?? r.image.bounds ?? null })
      }
    } else setError(r?.error ?? 'Upload didn’t go through — check signal and try again.')
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5 flex-1">
          <Camera className="h-3.5 w-3.5" /> Site imagery
          {dates.length > 0 && <span className="normal-case tracking-normal">· {dates.length} date{dates.length === 1 ? '' : 's'}</span>}
        </h2>
        {canEdit && (
          <button type="button" onClick={() => setShowUpload((s) => !s)}
            className="rounded-lg bg-navy-800 border border-navy-700 text-muted hover:text-ink text-[11px] font-semibold px-2.5 py-1">
            + Add photo
          </button>
        )}
      </div>

      {showUpload && (
        <div className="rounded-xl border border-navy-700 bg-navy-900 p-3 mb-2 flex flex-wrap items-center gap-2">
          <div className="w-full flex gap-1.5">
            {([['drone', '🛩 90° top-down drone'], ['ground', '📷 Site photo']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setViewType(v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${
                  viewType === v ? 'border-amber text-amber bg-amber/10' : 'border-navy-700 text-muted hover:text-ink'
                }`}>
                {label}
              </button>
            ))}
            <span className="self-center text-[10.5px] text-faint">
              {viewType === 'drone' ? 'goes on the map — auto-placed from the drone’s flight data' : 'timeline only'}
            </span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile}
            className="text-[11.5px] text-muted file:mr-2 file:rounded-lg file:border-0 file:bg-navy-700 file:text-ink file:px-2.5 file:py-1.5 file:text-xs" />
          {/* Android routes image/* inputs into the Google Photos picker with
              no way to reach the Files app (Dropbox/Drive). This unrestricted
              input opens the real file picker; the pick is stuffed into
              fileRef so the upload path stays one road. */}
          <label className="rounded-lg border border-navy-700 text-muted hover:text-ink text-[11px] font-semibold px-2.5 py-1.5 cursor-pointer">
            Browse files…
            <input type="file" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const named = /\.(png|jpe?g|webp|gif|heic|heif|avif|tiff?)$/i.test(f.name)
                if (!f.type.startsWith('image/') && !named) {
                  setError(`"${f.name}" isn't a photo — pick a JPG, PNG, WEBP, or HEIC.`)
                  return
                }
                setError(null)
                if (fileRef.current) {
                  const dt = new DataTransfer()
                  dt.items.add(f)
                  fileRef.current.files = dt.files
                }
                onPickFile()
              }} />
          </label>
          {preview && (
            <div className="w-full flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt="Selected photo" className="h-14 w-20 object-cover rounded-lg border border-navy-700" />
              <span className={`text-[11px] font-semibold ${preview.exact ? 'text-teal' : 'text-amber'}`}>
                📅 {preview.note}
              </span>
            </div>
          )}
          <input type="date" value={takenOn} max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setTakenOn(e.target.value)}
            className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-xs text-ink" />
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (e.g. “pad poured”)"
            className="flex-1 min-w-[140px] rounded-lg bg-navy-950 border border-navy-700 px-2.5 py-1.5 text-xs text-ink" />
          <button type="button" disabled={busy} onClick={upload}
            className="rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-1.5 disabled:opacity-40">
            {busy ? 'Uploading…' : 'Save'}
          </button>
        </div>
      )}

      {dates.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No site photos yet. Fly the site, add the shot with its date — the before/after
          builds itself and lands in the closeout record.
        </p>
      ) : current ? (
        <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
          {/* Hero rides a 1600px transform, never the raw 48 MP file — full-
              res decodes froze iPads ("zone page is freezing", Aug 7). Tap
              opens the full-screen pinch-zoom viewer — tall stitched panos
              letterbox down to a sliver in this 420px box and need a real
              look ("full images not showing", Aug 9). */}
          <button type="button" className="relative block w-full cursor-zoom-in"
            onClick={() => setViewing(current[1][Math.min(shot, current[1].length - 1)])}
            aria-label="View photo full screen">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbUrl((current[1][Math.min(shot, current[1].length - 1)]).url, 1600, 78)}
              onError={(e) => fallbackToRaw(e, (current[1][Math.min(shot, current[1].length - 1)]).url)}
              alt={`Site on ${current[0]}`}
              loading="lazy"
              className="w-full max-h-[420px] object-contain bg-navy-950"
            />
            <span className="absolute right-2 top-2 rounded-lg bg-navy-950/80 border border-navy-700 p-1.5 text-muted">
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          </button>
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Older date" disabled={idx >= dates.length - 1}
                onClick={() => { setIdx((i) => Math.min(dates.length - 1, i + 1)); setShot(0) }}
                className="rounded-lg border border-navy-700 p-1 text-muted disabled:opacity-30">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="flex-1 min-w-0 text-center">
                <p className="text-sm font-semibold text-ink">{fmt(current[0])}</p>
                <p className="text-[10.5px] text-faint truncate">
                  {SOURCE_LABEL[current[1][Math.min(shot, current[1].length - 1)].source]}
                  {current[1][Math.min(shot, current[1].length - 1)].caption && <> · {current[1][Math.min(shot, current[1].length - 1)].caption}</>}
                  {current[1].length > 1 && <> · shot {Math.min(shot, current[1].length - 1) + 1}/{current[1].length}</>}
                </p>
              </div>
              <button type="button" aria-label="Newer date" disabled={idx <= 0}
                onClick={() => { setIdx((i) => Math.max(0, i - 1)); setShot(0) }}
                className="rounded-lg border border-navy-700 p-1 text-muted disabled:opacity-30">
                <ChevronRight className="h-4 w-4" />
              </button>
              {canEdit && (
                <button type="button"
                  onClick={() => setPlacing(current[1][Math.min(shot, current[1].length - 1)])}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-semibold ${
                    current[1][Math.min(shot, current[1].length - 1)].bounds
                      ? 'border-teal/50 text-teal'
                      : 'border-navy-700 text-muted hover:text-ink'
                  }`}>
                  <MapPin className="h-3 w-3" />
                  {current[1][Math.min(shot, current[1].length - 1)].bounds ? 'Placed ✓' : 'Place on map'}
                </button>
              )}
              {canEdit && (
                <button type="button" aria-label="Delete this photo"
                  onClick={() => {
                    const im = current[1][Math.min(shot, current[1].length - 1)]
                    setImages((xs) => xs.filter((x) => x.id !== im.id)); setShot(0)
                    start(async () => { await deleteZoneImageryAction(zoneId, im.id) })
                  }}
                  className="rounded-lg border border-navy-700 p-1 text-faint hover:text-red-400">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Date slider — oldest left, newest right, like the map timeline. */}
            {dates.length > 1 && (
              <input
                type="range" min={0} max={dates.length - 1}
                value={dates.length - 1 - idx}
                onChange={(e) => { setIdx(dates.length - 1 - Number(e.target.value)); setShot(0) }}
                className="w-full accent-amber"
                aria-label="Imagery date"
              />
            )}
            {current[1].length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto">
                {current[1].map((im, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={im.id} src={thumbUrl(im.url, 160)} onError={(e) => fallbackToRaw(e, im.url)} alt="" loading="lazy" onClick={() => setShot(i)}
                    className={`h-12 w-16 object-cover rounded cursor-pointer border ${i === Math.min(shot, current[1].length - 1) ? 'border-amber' : 'border-navy-700 opacity-60'}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {error && <p className="text-sm text-red-400 mt-1">{error}</p>}
      {viewing && (
        <PhotoLightbox
          url={viewing.url}
          caption={[fmt(viewing.taken_on), viewing.caption].filter(Boolean).join(' · ')}
          onClose={() => setViewing(null)}
        />
      )}
      {placing && (
        <OverlayPlacer
          zoneId={zoneId}
          imageId={placing.id}
          imageUrl={placing.url}
          ring={ring}
          initialBounds={(placing.bounds ?? null) as Corners | null}
          hint={smartHint}
          onClose={() => { setPlacing(null); setSmartHint(null) }}
          onSaved={(b) => {
            setImages((xs) => xs.map((x) => (x.id === placing.id ? { ...x, bounds: b } : x)))
            setPlacing(null); setSmartHint(null)
          }}
        />
      )}
    </section>
  )
}
