'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Images, X, MapPin, Check, CalendarClock } from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { createPhotoUploadAction, finalizePhotoAction, listPhotoSitesAction, locatePhotosByTimeAction } from '@/lib/actions/photos'
import type { FieldPhoto } from '@/lib/db/photos'
import { busy as trackBusy } from '@/lib/busy'
import { nativePhotosAvailable, pickOriginalPhotos, readNativePhoto, clearNativePhotos } from '@/lib/native-photos'

/**
 * Take or add job photos that land on the map (Brian, Sep 9).
 *
 * Every shot carries WHERE and WHEN — and the hard rule, learned the hard
 * way (Brian, Sep 12: "just tried the upload function and it put them at my
 * house instead of at creekside where they were actually taken yesterday"):
 * a photo NEVER inherits where you are standing now unless you just took it.
 *
 * The trap is that Android redacts the EXIF GPS out of anything handed to a
 * file picker — an app only gets the original by asking MediaStore for it,
 * and a WebView's file input never does. So "gallery photos use the location
 * in the picture" quietly had no location to use, and the old code filled the
 * hole with the live fix. That is not a missing pin; it is a CONFIDENTLY
 * WRONG one, on a map people attach to pay apps and insurance claims.
 *
 * So: camera shots use the live fix (you are there). Gallery photos use their
 * EXIF when it survived — iPhones and anything copied off a real camera or
 * the drone usually keep it — and otherwise stay UNPLACED until somebody says
 * which job it was. Same for the clock: EXIF date, else the file's own
 * timestamp, else you set it — never a silent "now" that files yesterday's
 * work under today.
 *
 * Full-size + a 320 px thumbnail stream straight to storage (signed URLs —
 * the file never rides a server action), then finalize records the shot.
 */
type Fix = { lat: number; lng: number; acc: number | null; heading: number | null }
type Site = { id: string; name: string; lat: number; lng: number }
/** Where the pin came from. 'site' is a filing, not a measurement — it saves
 *  with no accuracy and the tile says the site's name instead of a ±. */
type FixSrc = 'exif' | 'gps' | 'site' | 'track' | 'clock'
type Item = {
  key: string; file: File; preview: string
  fix: Fix | null; fixSrc: FixSrc | null; siteId: string | null; siteName: string | null
  takenAt: string | null
  /** Where the clock came from, so a guess can be labelled as one. */
  timeSrc: 'exif' | 'file' | 'set' | 'now'
  fromCamera: boolean
  /** Where we worked out the person WAS at that moment, when the picture
   *  itself would not say. Applied straight away when the photo carries a
   *  real capture time; offered as a one-tap suggestion when the clock was
   *  itself a guess. */
  guess: { lat: number; lng: number; source: 'track' | 'clock'; zoneId: string | null; zoneName: string | null } | null
  state: 'ready' | 'uploading' | 'done' | 'error'; error?: string
}

/** `2026-09-11T14:30` for a datetime-local input, in the viewer's own zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function PhotoCaptureSheet({ open, onClose, onSaved }: {
  open: boolean
  onClose: () => void
  onSaved?: (photo: FieldPhoto) => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [live, setLive] = useState<Fix | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  // Can this device hand us the photo's OWN coordinates? Only the native
  // shell on Android 10+ can; everywhere else the web input is the door.
  const [nativeGallery, setNativeGallery] = useState(false)
  const [denied, setDenied] = useState(false)
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

  // The jobs a photo can be filed under, fetched once per opening. Only ever
  // needed when something arrives without a location, but it has to be in
  // hand by then — asking after the fact is a spinner in the way.
  useEffect(() => {
    if (!open) return
    let alive = true
    void nativePhotosAvailable().then((ok) => { if (alive) setNativeGallery(ok) })
    return () => { alive = false }
  }, [open])

  useEffect(() => {
    if (!open || sites.length) return
    let alive = true
    void listPhotoSitesAction().then((rows) => { if (alive) setSites(rows) }).catch(() => {})
    return () => { alive = false }
  }, [open, sites.length])

  useEffect(() => {
    if (open) return
    setItems((xs) => { xs.forEach((x) => URL.revokeObjectURL(x.preview)); return [] })
    setCaption(''); setDenied(false)
    void clearNativePhotos()
  }, [open])

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
      // ONLY a camera shot may borrow the live fix — you are standing there.
      // A gallery photo with no EXIF stays unplaced until somebody names the
      // job; the alternative is pinning last week's work to wherever you
      // happen to be reading your phone.
      if (!fix && fromCamera && live) { fix = live; fixSrc = 'gps' }
      let timeSrc: Item['timeSrc'] = 'now'
      if (fromCamera) { takenAt = new Date().toISOString(); timeSrc = 'now' }
      else if (takenAt) timeSrc = 'exif'
      else if (Number.isFinite(file.lastModified) && file.lastModified > 0) {
        // The file's own timestamp. Not gospel — a photo copied between
        // phones carries the copy's time — but it is yesterday when the shot
        // was yesterday, which "now" never is. Shown, and editable.
        takenAt = new Date(file.lastModified).toISOString()
        timeSrc = 'file'
      }
      next.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file, preview: URL.createObjectURL(file),
        fix, fixSrc, siteId: null, siteName: null,
        takenAt, timeSrc, fromCamera, guess: null, state: 'ready',
      })
    }
    setItems((xs) => [...xs, ...next])
    void locateByTime(next)
  }

  /**
   * The gallery, read natively, so the photo's OWN coordinates survive.
   *
   * The web file input cannot do this on Android: the OS redacts the GPS out
   * of whatever it hands a file chooser. The plugin asks MediaStore for the
   * unredacted original instead, reads the EXIF off those exact bytes, and
   * hands us the picture one at a time.
   *
   * A photo that still arrives without coordinates — permission refused, an
   * OEM that ignores the request, or a picture that simply never had a fix
   * (a screenshot, something texted to you) — falls into exactly the same
   * unplaced path as before. The door changed; the honesty did not.
   */
  async function addNative() {
    const { photos, denied: refused } = await pickOriginalPhotos()
    setDenied(refused)
    if (!photos.length) return
    const done = trackBusy(`Reading ${photos.length} photo${photos.length === 1 ? '' : 's'}…`)
    const next: Item[] = []
    try {
      for (const meta of photos) {
        const file = await readNativePhoto(meta)
        if (!file) continue
        const fix = meta.hasGps && Number.isFinite(meta.lat) && Number.isFinite(meta.lng)
          ? { lat: meta.lat as number, lng: meta.lng as number, acc: null, heading: null }
          : null
        // The plugin's takenAt is EXIF DateTimeOriginal — a real capture time.
        // Only when the picture carries none do we fall back to the file's.
        const takenAt = meta.takenAt ? new Date(meta.takenAt).toISOString()
          : (Number.isFinite(file.lastModified) && file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null)
        next.push({
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file, preview: URL.createObjectURL(file),
          fix, fixSrc: fix ? 'exif' : null, siteId: null, siteName: null,
          takenAt, timeSrc: meta.takenAt ? 'exif' : takenAt ? 'file' : 'now',
          fromCamera: false, guess: null, state: 'ready',
        })
      }
    } finally { done() }
    setItems((xs) => [...xs, ...next])
    void locateByTime(next)
  }

  /**
   * Ask our own data where this person was when the shutter went.
   *
   * Runs only for photos that arrived WITHOUT coordinates, which on Android
   * is most of them — the OS strips the GPS but leaves the clock, and the
   * clock is enough when we already recorded where everybody was.
   *
   * A real capture time (EXIF) places the photo outright. A guessed one (the
   * file's own timestamp, which a copied photo carries from the copy) only
   * earns a one-tap suggestion — being roughly right is not a licence to be
   * silently wrong.
   */
  async function locateByTime(batch: Item[]) {
    const need = batch.filter((x) => !x.fix && x.takenAt)
    if (!need.length) return
    let found: Awaited<ReturnType<typeof locatePhotosByTimeAction>>
    try { found = await locatePhotosByTimeAction(need.map((x) => x.takenAt as string)) }
    catch { return }
    const byKey = new Map(need.map((x, i) => [x.key, found[i] ?? null]))
    setItems((xs) => xs.map((x) => {
      const hit = byKey.get(x.key)
      if (!hit || x.fix || x.state !== 'ready') return x
      if (x.timeSrc === 'exif') {
        return {
          ...x,
          fix: { lat: hit.lat, lng: hit.lng, acc: null, heading: null },
          fixSrc: hit.source, siteId: hit.zoneId, siteName: hit.zoneName, guess: hit,
        }
      }
      return { ...x, guess: hit }
    }))
  }

  /** Take the suggestion for everything still unplaced that has one. */
  const useGuesses = () => setItems((xs) => xs.map((x) => (x.state === 'ready' && !x.fix && x.guess
    ? { ...x, fix: { lat: x.guess.lat, lng: x.guess.lng, acc: null, heading: null }, fixSrc: x.guess.source, siteId: x.guess.zoneId, siteName: x.guess.zoneName }
    : x)))

  /** Place everything still unplaced — a batch off one phone is one job and
   *  one decision, not N taps. A photo that already knows where it was is
   *  never touched. */
  const placeAtSite = (id: string) => {
    const site = sites.find((z) => z.id === id)
    if (!site) return
    setItems((xs) => xs.map((x) => (x.state === 'ready' && !x.fix
      ? { ...x, fix: { lat: site.lat, lng: site.lng, acc: null, heading: null }, fixSrc: 'site', siteId: site.id, siteName: site.name }
      : x)))
  }
  const placeHere = () => {
    if (!live) return
    setItems((xs) => xs.map((x) => (x.state === 'ready' && !x.fix ? { ...x, fix: live, fixSrc: 'gps', siteId: null, siteName: null } : x)))
  }
  /** One clock for the batch. Only moves the photos that were GUESSING —
   *  a shot with a real EXIF timestamp keeps it. */
  const setWhen = (localValue: string) => {
    const t = Date.parse(localValue)
    if (!Number.isFinite(t)) return
    const iso = new Date(t).toISOString()
    setItems((xs) => xs.map((x) => (x.state === 'ready' && x.timeSrc !== 'exif' ? { ...x, takenAt: iso, timeSrc: 'set' } : x)))
  }

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
          takenAt: it.takenAt, caption: caption || null,
          // `source` is where the PICTURE came from, not how it got pinned —
          // a gallery shot placed by hand is still an import.
          source: it.fromCamera ? 'camera' : 'import',
          geofenceId: it.siteId,
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
  const unplaced = pending.length - savable
  // The clock we had to guess at, if any — EXIF wins and is never offered up
  // for editing, so this only appears when it would otherwise be a guess.
  const guessedWhen = pending.find((x) => x.timeSrc !== 'exif')?.takenAt ?? null
  // Our own answer to "where was this taken", when the picture would not say.
  const guessName = pending.find((x) => !x.fix && x.guess)?.guess?.zoneName ?? null
  const allDone = items.length > 0 && items.every((x) => x.state === 'done')

  return (
    <div className="fixed inset-0 z-[80] flex items-end md:items-center justify-center bg-navy-950/60" onClick={onClose}>
      <div className="w-full md:max-w-lg bg-navy-900 border border-navy-700 rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[calc(88dvh-var(--ht-safe-bottom,0px))] flex flex-col" onClick={(e) => e.stopPropagation()}>
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
            <button type="button" onClick={() => { if (nativeGallery) void addNative(); else galRef.current?.click() }} className="flex items-center justify-center gap-2 rounded-xl border border-navy-700 bg-navy-950 text-ink font-semibold py-3 active:scale-95">
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
                      : it.fix ? (
                        <span className="text-faint truncate block">
                          📍 {it.fixSrc === 'exif' ? 'from photo'
                            : it.fixSrc === 'track' ? (it.siteName ?? 'your track')
                            : it.fixSrc === 'clock' ? (it.siteName ?? 'your shift')
                            : it.fixSrc === 'site' ? (it.siteName ?? 'site')
                            : 'here'}
                          {it.takenAt && <span className="text-faint/70"> · {new Date(it.takenAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
                        </span>
                      )
                      : <span className="text-amber">no location yet</span>}
                  </div>
                  {it.state === 'ready' && (
                    <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))} aria-label="Remove" className="absolute top-1 right-1 grid place-items-center w-6 h-6 rounded-full bg-navy-950/80 text-faint hover:text-ink"><X className="h-3.5 w-3.5" /></button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {denied && (
            <p className="rounded-lg border border-navy-700 bg-navy-950 p-2.5 text-[11.5px] text-faint leading-snug">
              Without access to your photos we can&apos;t read the location saved inside them, so you&apos;ll be asked
              which job each one was. To let it read them: <span className="text-ink">Settings → Apps → HammerTrack → Permissions → Photos</span>.
            </p>
          )}

          {/* The ask. Android hands a web page a gallery photo with its GPS
              stripped, so this is the NORMAL path for added pictures — not a
              rare error state. It asks once for the whole batch, because a
              batch off one phone is one job. */}
          {unplaced > 0 && (
            <div className="rounded-xl border border-amber/40 bg-amber/10 p-3 space-y-2">
              <p className="text-[12.5px] text-amber font-semibold leading-snug">
                {unplaced === 1 ? 'This photo has no location saved in it.' : `${unplaced} photos have no location saved in them.`}
                <span className="block font-normal text-[11.5px] text-amber/80 mt-0.5">
                  Phones strip it when you share a picture out of the gallery.
                  {guessName ? ' We checked where you were at that time:' : ' Tell us which job it was and it lands there.'}
                </span>
              </p>
              {guessName && (
                <button type="button" onClick={useGuesses}
                  className="w-full rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[13px] py-2.5 active:scale-[0.98]">
                  You were at {guessName} — use that
                </button>
              )}
              {sites.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => { placeAtSite(e.target.value); e.target.value = '' }}
                  className="w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2.5 text-sm text-ink"
                >
                  <option value="" disabled>Pick the job site…</option>
                  {sites.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              )}
              <button type="button" onClick={placeHere} disabled={!live}
                className="w-full rounded-lg border border-navy-700 bg-navy-950 text-ink text-[12.5px] font-semibold py-2 disabled:opacity-40">
                {live ? 'Or: I am standing there right now' : 'Or: where I am now (finding you…)'}
              </button>
            </div>
          )}

          {/* WHEN, when we had to guess. A photo of yesterday's grade filed
              under today is wrong on the timeline, in the day's report and in
              every replay that scrubs past it. */}
          {guessedWhen && (
            <label className="flex items-center gap-2 text-[12px] text-faint">
              <CalendarClock className="h-4 w-4 text-teal flex-none" />
              <span className="flex-none">Taken</span>
              <input
                type="datetime-local"
                value={toLocalInput(guessedWhen)}
                max={toLocalInput(new Date().toISOString())}
                onChange={(e) => setWhen(e.target.value)}
                className="flex-1 min-w-0 rounded-lg bg-navy-950 border border-navy-700 px-2 py-1.5 text-[12.5px] text-ink"
              />
            </label>
          )}

          <input value={caption} onChange={(e) => setCaption(e.target.value.slice(0, 240))} placeholder="Caption (optional) — what are we looking at?" className="w-full rounded-lg bg-navy-950 border border-navy-700 px-3 py-2 text-sm text-ink" />
          <p className="text-[11.5px] text-faint">Photos land on the map where they were taken and file under the site they fall in. A photo you take here uses your location now. A photo from the gallery uses the coordinates saved inside it{nativeGallery ? '' : ' — and when the phone stripped those out, we place it from where you were at that time'}.</p>
        </div>

        {/* The OS nav bar overlays the viewport in the native shell
            (viewport-fit=cover), so a bottom sheet has to pay the inset
            itself or its buttons sit under the system bar — Brian, Sep 12,
            on this exact sheet. The height cap pays it too, or a tall sheet
            just pushes the footer back under the bar. */}
        <div className="p-4 pt-2 pb-[calc(1rem+var(--ht-safe-bottom,0px))] border-t border-navy-800 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-navy-700 text-muted py-3 text-sm font-semibold hover:text-ink">{allDone ? 'Done' : 'Cancel'}</button>
          <button type="button" disabled={busy || savable === 0} onClick={saveAll} className="flex-[2] rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3 disabled:opacity-40">
            {busy ? 'Saving…' : savable ? `Save ${savable} photo${savable === 1 ? '' : 's'}` : pending.length ? 'Pick where they were taken' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
