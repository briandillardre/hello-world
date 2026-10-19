'use client'

import { useEffect, useState } from 'react'
import { Video, Plus, Trash2, ExternalLink } from 'lucide-react'
import { addZoneCameraAction, removeZoneCameraAction } from '@/lib/actions/zone-cameras'
import { cameraOpenUrl, type ZoneCamera } from '@/lib/zone-cameras'
import { nativePlatform } from '@/lib/native'

const NO_REPLY = 'No answer from the server — try again.'

/** One tap per camera to its live view. Shared by the zone page and the map's
 *  zone sheet (`compact`). */
export function CameraButtons({ cameras, compact = false }: { cameras: ZoneCamera[]; compact?: boolean }) {
  const [platform, setPlatform] = useState('web')
  const [ua, setUa] = useState('')
  useEffect(() => { setPlatform(nativePlatform()); setUa(navigator.userAgent) }, [])
  if (!cameras.length) return null
  return (
    <div className={compact ? 'mt-2 flex flex-wrap gap-2' : 'flex flex-wrap gap-2'}>
      {cameras.map((c) => {
        const href = cameraOpenUrl(c, platform, ua)
        const cls = 'inline-flex items-center gap-1.5 rounded-lg bg-navy-800 border border-navy-700 text-ink text-sm font-medium px-3 py-2 hover:bg-navy-700 transition-colors'
        return href ? (
          <a key={c.id} href={href} target="_blank" rel="noopener noreferrer" className={cls}>
            <Video className="h-4 w-4 text-teal" /> {c.name}
            {c.kind === 'ubox' && <span className="text-[11px] text-faint">· UBox app</span>}
            <ExternalLink className="h-3 w-3 text-faint" />
          </a>
        ) : (
          <span key={c.id} className={`${cls} opacity-60`} title="Watched in the UBox app on a phone">
            <Video className="h-4 w-4 text-faint" /> {c.name} <span className="text-[11px] text-faint">· UBox app on your phone</span>
          </span>
        )
      })}
    </div>
  )
}

export function ZoneCameras({ zoneId, initial, canEdit }: { zoneId: string; initial: ZoneCamera[]; canEdit: boolean }) {
  const [cams, setCams] = useState(initial)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'ubox' | 'link'>('ubox')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canEdit && cams.length === 0) return null

  const add = async () => {
    setBusy(true); setError(null)
    const r = await addZoneCameraAction(zoneId, { name, kind, url })
    setBusy(false)
    if (!r?.ok) { setError(r && 'error' in r ? r.error : NO_REPLY); return }
    setCams([...cams, { id: r.id ?? crypto.randomUUID(), name: name.trim(), kind, url: kind === 'link' ? url.trim() : null }])
    setName(''); setUrl(''); setAdding(false)
  }
  const remove = async (id: string) => {
    const r = await removeZoneCameraAction(id)
    if (!r?.ok) { setError(r && 'error' in r ? r.error : NO_REPLY); return }
    setCams(cams.filter((c) => c.id !== id))
  }

  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2 flex items-center gap-1.5">
        <Video className="h-3.5 w-3.5 text-teal" /> Site cameras
      </h2>
      <div className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-3">
        {cams.length === 0 && <p className="text-[12.5px] text-faint">Add the camera watching this site — one tap here opens its live view.</p>}
        <CameraButtons cameras={cams} />
        {canEdit && cams.length > 0 && (
          <ul className="space-y-1">
            {cams.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-[12px] text-faint">
                <span>{c.name} · {c.kind === 'ubox' ? 'UBox app' : c.url}</span>
                <button onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`} className="p-1.5 hover:text-alert"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (adding ? (
          <div className="space-y-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name — e.g. Gate PTZ" maxLength={80}
              className="w-full bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-amber/50" />
            <div className="flex gap-2 text-[12.5px]">
              {(['ubox', 'link'] as const).map((k) => (
                <button key={k} onClick={() => setKind(k)}
                  className={`flex-1 rounded-lg border px-3 py-2 ${kind === k ? 'border-teal bg-teal/15 text-teal' : 'border-navy-700 text-faint'}`}>
                  {k === 'ubox' ? 'UBox app (Tefrio 4G)' : 'Web link'}
                </button>
              ))}
            </div>
            {kind === 'link' && (
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… the camera’s viewer page" inputMode="url"
                className="w-full bg-navy-950 border border-navy-700 rounded-lg px-3 py-2 text-[13px] text-ink placeholder:text-faint outline-none focus:border-amber/50" />
            )}
            {kind === 'ubox' && <p className="text-[11.5px] text-faint">Opens the UBox app on the phone (Android: tap Open on the Play page). Sign in to UBox once on each phone.</p>}
            <div className="flex gap-2">
              <button onClick={add} disabled={busy || !name.trim()}
                className="rounded-lg bg-teal/15 border border-teal/40 text-teal text-[12px] font-semibold px-3 py-1.5 disabled:opacity-40">
                {busy ? 'Saving…' : 'Save camera'}
              </button>
              <button onClick={() => setAdding(false)} className="text-[12px] text-faint px-2">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[12px] text-teal font-semibold">
            <Plus className="h-3.5 w-3.5" /> Add a camera
          </button>
        ))}
        {error && <p className="text-[11.5px] text-alert">{error}</p>}
      </div>
    </section>
  )
}
