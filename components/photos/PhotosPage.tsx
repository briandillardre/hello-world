'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Camera, MapPin, Trash2 } from 'lucide-react'
import { PhotoCaptureSheet } from './PhotoCaptureSheet'
import { PhotoLightbox } from '@/components/zones/PhotoLightbox'
import { deletePhotoAction } from '@/lib/actions/photos'
import type { FieldPhoto } from '@/lib/db/photos'
import { useRouter } from 'next/navigation'

/**
 * /photos — every geotagged job photo, newest day first, grouped by the site
 * it fell in. The big button takes more. Tap a picture to see it full size;
 * "on the map" opens the map centred on it with the Photos layer on.
 */
export function PhotosPage({ photos, canEdit, myId, demo }: { photos: FieldPhoto[]; canEdit: boolean; myId: string | null; demo: boolean }) {
  const router = useRouter()
  const [sheet, setSheet] = useState(false)
  const [lightbox, setLightbox] = useState<FieldPhoto | null>(null)
  const [list, setList] = useState(photos)
  const [filterZone, setFilterZone] = useState<string>('')

  const zones = useMemo(() => Array.from(new Set(list.map((p) => p.zone ?? 'Off-site'))).sort(), [list])
  const shown = filterZone ? list.filter((p) => (p.zone ?? 'Off-site') === filterZone) : list
  const byDay = useMemo(() => {
    const m = new Map<string, FieldPhoto[]>()
    for (const p of shown) {
      const k = new Date(p.taken_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(p)
    }
    return Array.from(m.entries())
  }, [shown])

  async function remove(p: FieldPhoto) {
    if (!window.confirm('Remove this photo from the map and the index?')) return
    const r = await deletePhotoAction(p.id)
    if (r.ok) { setList((xs) => xs.filter((x) => x.id !== p.id)); setLightbox(null) }
    else window.alert(r.error ?? 'Could not remove it.')
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <h1 className="font-display font-bold text-xl text-ink">Photos</h1>
            <p className="text-[12.5px] text-faint">Every job photo, pinned where it was taken. Camera shots from here or the map&apos;s 📷 button, plus the pictures on daily logs.</p>
          </div>
          <button type="button" onClick={() => setSheet(true)} disabled={demo} className="inline-flex items-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-4 py-2.5 disabled:opacity-50 active:scale-95">
            <Camera className="h-4 w-4" /> Take photos
          </button>
        </div>

        {zones.length > 1 && (
          <div className="flex gap-1.5 flex-wrap">
            <button type="button" onClick={() => setFilterZone('')} className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (!filterZone ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>All sites</button>
            {zones.map((z) => (
              <button key={z} type="button" onClick={() => setFilterZone(z)} className={'rounded-full px-3 py-1 text-[12px] font-semibold border ' + (filterZone === z ? 'bg-teal/15 border-teal/40 text-teal' : 'border-navy-700 text-muted')}>{z}</button>
            ))}
          </div>
        )}

        {list.length === 0 && (
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-8 text-center text-sm text-muted">
            {demo ? 'Sign in on the live app to see your crew’s photos.' : 'No photos yet. Take the first one — it lands on the map where you stand.'}
          </div>
        )}

        {byDay.map(([day, ps]) => (
          <section key={day}>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint mb-2">{day} · {ps.length}</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1.5">
              {ps.map((p) => (
                <button key={p.id} type="button" onClick={() => setLightbox(p)} className="relative aspect-square rounded-lg overflow-hidden border border-navy-800 bg-navy-950">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb_url ?? p.url} alt={p.caption ?? 'Job photo'} loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 bg-navy-950/75 text-[10px] text-ink truncate text-left">{p.zone ?? 'Off-site'}{p.by ? ` · ${p.by}` : ''}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <PhotoCaptureSheet open={sheet} onClose={() => { setSheet(false); router.refresh() }} onSaved={(p) => setList((xs) => [p, ...xs])} />
      {lightbox && (
        <>
          <PhotoLightbox url={lightbox.url} caption={[lightbox.zone ?? 'Off-site', lightbox.by, new Date(lightbox.taken_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), lightbox.caption].filter(Boolean).join(' · ')} onClose={() => setLightbox(null)} />
          <div className="fixed bottom-[calc(54px+var(--ht-safe-bottom,0px)+12px)] md:bottom-6 inset-x-0 z-[91] flex justify-center gap-2 pointer-events-none">
            <Link href={`/map?lat=${lightbox.lat}&lng=${lightbox.lng}&z=17&layer=photos`} className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-navy-900/90 border border-navy-700 text-ink text-[12px] font-semibold px-3 py-1.5">
              <MapPin className="h-3.5 w-3.5 text-teal" /> On the map
            </Link>
            {(canEdit || (myId && lightbox.user_id === myId)) && (
              <button type="button" onClick={() => remove(lightbox)} className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-navy-900/90 border border-navy-700 text-alert text-[12px] font-semibold px-3 py-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
