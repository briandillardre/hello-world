'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Images, X, MapPin, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { createPhotoUploadAction, finalizePhotoAction } from '@/lib/actions/photos'
import type { FieldPhoto } from '@/lib/db/photos'
import { busy as trackBusy } from '@/lib/busy'

/**
 * Take or add job photos that land on the map (Brian, Sep 9). Every shot
 * carries WHERE it was taken: the phone's live fix for camera shots, the EXIF
 * GPS for pictures picked from the gallery (a gallery photo without one can
 * be pinned to where you stand). Full-size + a 320 px thumbnail stream
 * straight to storage (signed URLs — the file never rides a server action),
 * then finalize records the shot under the site it fell in.
 */
type Fix = { lat: number; lng: number; acc: number | null; heading: number | null }
type Item = { key: string; file: File; preview: string; fix: Fix | null; fixSrc: 'exif' | 'gps' | null; takenAt: string | null; state: 'ready' | 'uploading' | 'done' | 'error'; error?: string }

export function PhotoCaptureSheet({ open, onClose, onSaved }: {
  open: boolean
  onClose: () => void
  onSaved?: (photo: FieldPhoto) => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [live, setLive] = useState<Fix | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const camRef = useRef<HTMLInputElement>(null)
  const galRef = useRef<HTMLInputElement>(null)

  // Live fix while the sheet is open — camera shots get the best reading we
  // have at the moment they are picked.
  useEffect(() => {
    if (!open || typeof navigator === 'undefined' || !('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (p) => setLive({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null, heading: Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : null }),
      () => { /* denied — gallery photos with EXIF still work */ },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [open])

  useEffect(() => { if (!open) { setItems((xs) => { xs.forEach((x) => URL.revokeObjectURL(x.preview)); return [] }); setCaption('') } }, [open])

  async function add(files: FileList | null, fromCamera: boolean) {
    if (!files?.length) return
    const next: Item[] = []
    for (const file of Array.from(files).slice(0, 12)) {
      if (!file.type.startsWith('image/')) continue
      let fix: Fix | null = null
      let fixSrc: Item['fixSrc'] = null
      let takenAt: string | null = null
      try {
        const exifr = (await import('exifr')).default
        const [g, meta] = await Promise.all([
          exifr.gps(file).catch(() => null) as Promise<{ latitude?: number; longitude?: number } | null>,
          exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'GPSImgDirection'] }).catch(() => null) as Promise<Record<string, unknown> | null>,
        ])
        if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude) && !(g.latitude === 0 && g.longitude === 0)) {
          fix = { lat: g.latitude as number, lng: g.longitude as number, acc: null, heading: typeof meta?.GPSImgDirection === 'number' ? (meta.GPSImgDirection as number) : null }
          fixSrc = 'exif'
        }
        const d = (meta?.DateTimeOriginal ?? meta?.CreateDate) as Date | string | undefined
        const t = d instanceof Date ? d.getTime() : d ? Date.parse(String(d)) : NaN
        if (Number.isFinite(t)) takenAt = new Date(t).toISOString()
      } catch { /* no EXIF */ }
      if (!fix && (fromCamera || live)) { fix = live; fixSrc = live ? 'gps' : null }
      next.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, preview: URL.createObjectURL(file), fix, fixSrc, takenAt: fromCamera ? null : takenAt, state: 'ready' })
    }
    setItems((xs) => [...xs, ...next])
  }

  /** Pin a gallery photo without EXIF to where the phone is right now. */
  const pinHere = (key: string) => { if (!live) return; setItems((xs) => xs.map((x) => (x.key === key ? { ...x, fix: live, fixSrc: 'gps' } : x))) }

  async function makeThumb(file: File): Promise<Blob | null> {
    try {
      const bmp = await createImageBitmap(file)
      const scale = Math.min(1, 320 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale))
      const ctx = c.getContext('2d'); if (!ctx) return null
      ctx.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close?.()
      return await new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.82))
    } catch { return null }
  }

  async function saveAll() {
    const ready = items.filter((x) => x.state === 'ready' && x.fix)
    if (!ready.length) return
    setBusy(true)
    const done = trackBusy(`Uploading ${ready.length} photo${ready.length === 1 ? '' : 's'}…`)
    const storage = createClient().storage.from('field-photos')
    for (const it of ready) {
      setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, state: 'uploading' } : x)))
      try {
        const type = it.file.type || 'image/jpeg'
        const pre = await createPhotoUploadAction(type, it.file.size)
        if (!pre.ok || !pre.path || !pre.token) throw new Error(pre.error || 'Upload didn’t start')
        const [thumb, up] = await Promise.all([makeThumb(it.file), storage.uploadToSignedUrl(pre.path, pre.token, it.file, { contentType: type })])
        if (up.error) throw new Error('Upload didn’t go through — check signal and try again.')
        let thumbPath: string | null = null
        if (thumb && pre.thumbPath && pre.thumbToken) {
          const t = await storage.uploadToSignedUrl(pre.thumbPath, pre.thumbToken, thumb, { contentType: 'image/jpeg' })
          if (!t.error) thumbPath = pre.thumbPath
        }
        const fin = await finalizePhotoAction({
          path: pre.path, thumbPath, lat: it.fix!.lat, lng: it.fix!.lng, accuracy: it.fix!.acc, heading: it.fix!.heading,
          takenAt: it.takenAt, caption: caption || null, source: it.fixSrc === 'exif' ? 'import' : 'camera',
        })
        if (!fin.ok || !fin.photo) throw new Error(fin.error || 'Save failed')
        setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, state: 'done' } : x)))
        onSaved?.(fin.photo)
      } catch (err) {
        setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, state: 'error', error: err instanceof Error ? err.message : 'Failed' } : x)))
      }
    }
    done(); setBusy(false)
    window.dispatchEvent(new CustomEvent('ht:photo-added'))
  }

  if (!open) return null
  const pending = items.filter((x) => x.state === 'ready')
  const savable = pending.filter((x) => x.fix).length
  const allDone = items.length > 0 && items.every((x) => x.state === 'done')

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center bg-navy-950/60" onClick={onClose}>
      <div className="w-full md:max-w-lg bg-navy-900 border border-navy-700 rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[88dvh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-navy-800">
          <Camera className="h-4 w-4 text-teal" />
          <h2 className="font-display font-bold text-[15px] text-ink flex-1">Job photos</h2>
          <span className="text-[11px] text-faint inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{live ? `±${Math.round(live.acc ?? 0)} m` : 'finding you…'}</span>
          <button type="button" onClick={onClose} aria-label="Close" className="grid place-items-center w-8 h-8 rounded-full bg-navy-800 border border-navy-700 text-faint hover:text-ink"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => camRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-teal/40 bg-teal/10 text-teal font-semibold py-3 active:scale-95">
              <Camera className="h-4 w-4" /> Take photo
            </button>
            <button type="button" onClick={() => galRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-navy-700 bg-navy-950 text-ink font-semibold py-3 active:scale-95">
              <Images className="h-4 w-4" /> From gallery
            </button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { void add(e.target.files, true); e.target.value = '' }} />
            <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void add(e.target.files, false); e.target.value = '' }} />
          </div>

          {items.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {items.map((it) => (
                <li key={it.key} className="relative rounded-lg overflow-hidden border border-navy-700 bg-navy-950 aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.preview} alt="" className={'w-full h-full object-cover ' + (it.state === 'done' ? 'opacity-70' : '')} />
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-navy-950/80 text-[10px] leading-tight">
                    {it.state === 'done' ? <span className="text-teal inline-flex items-center gap-1"><Check className="h-3 w-3" /> saved</span>
                      : it.state === 'uploading' ? <span className="text-amber">uploading…</span>
                      : it.state === 'error' ? <span className="text-alert">{it.error}</span>
                      : it.fix ? <span className="text-faint">📍 {it.fixSrc === 'exif' ? 'from photo' : 'here'}</span>
                      : <button type="button" onClick={() => pinHere(it.key)} disabled={!live} className="text-amber underline disabled:opacity-50">no location · pin it here</button>}
                  </div>
                  {it.state === 'ready' && (
                    <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} aria-label="Remove" className="absolute top-1 right-1 grid place-items-center w-6 h-6 rounded-full bg-navy-950/80 text-faint hover:text-ink"><X className="h-3.5 w-3.5" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <input value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 240))} placeholder="Caption (optional) — what are we looking at?" className="w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2 text-sm text-ink" />
          <p className="text-[11.5px] text-faint">Photos land on the map where they were taken and file under the site they fall in. Camera shots use your location now; gallery photos use the location in the picture.</p>
        </div>

        <div className="p-4 pt-2 border-t border-navy-800 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-navy-700 text-muted py-3 text-sm font-semibold hover:text-ink">{allDone ? 'Done' : 'Cancel'}</button>
          <button type="button" disabled={busy || savable === 0} onClick={saveAll} className="flex-[2] rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3 disabled:opacity-40">
            {busy ? 'Saving…' : savable ? `Save ${savable} photo${savable === 1 ? '' : 's'}` : pending.length ? 'Waiting for a location…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
