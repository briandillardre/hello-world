'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Clapperboard, Share2, X, Download, Send, Link2 } from 'lucide-react'
import { EXPORT_KINDS, deliverLink, copyText, type ExportKind, type DeliveryHow } from '@/lib/map-export'
import type { ExportLink } from '@/lib/export-upload'
import { isNativeApp } from '@/lib/native'
import { toast } from '@/components/ui/feedback'

/**
 * The export flyout (Brian, Sep 12: "when you click button i should see 3
 * options to the left — PDF, PNG, and GIF"; Sep 19: "Need share option to
 * send link to show certain screen setup to team members").
 *
 * One rail button, four answers, opening LEFT of the rail so a thumb on the
 * right edge never covers the choice it is about to make. Three are files;
 * the fourth shares THIS SCREEN — layers, camera, time — as a link.
 *
 * It also exists because the old PDF button looked broken. It was not — it
 * built the file and then handed it to a door that does not exist inside the
 * app (see lib/map-export.ts). Every export now ENDS somewhere visible, and
 * since Sep 19 every file also ends as a LINK (lib/export-upload.ts), which
 * is the door that works inside the app.
 */

const ICONS: Record<ExportKind, typeof FileText> = { pdf: FileText, png: ImageIcon, gif: Clapperboard, link: Share2 }

export function ExportMenu({ open, onClose, onPick, anchorTop }: {
  open: boolean
  onClose: () => void
  onPick: (kind: ExportKind) => void
  /** Distance from the top of the map to the rail button, so the flyout
   *  lines up with it instead of floating. */
  anchorTop: number
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // A frame's delay, or the click that OPENED it closes it again.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', away)
      document.addEventListener('touchstart', away)
      document.addEventListener('keydown', esc)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', away)
      document.removeEventListener('touchstart', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      ref={ref}
      className="absolute z-40 right-[58px] flex flex-col gap-1.5"
      style={{ top: anchorTop }}
      role="menu"
      aria-label="Export or share this view"
    >
      {EXPORT_KINDS.map((k) => {
        const Icon = ICONS[k.key]
        return (
          <button
            key={k.key}
            type="button"
            role="menuitem"
            onClick={() => { onPick(k.key); onClose() }}
            className="flex items-center gap-2.5 rounded-xl border border-navy-700 bg-navy-950/95 backdrop-blur pl-3 pr-4 py-2.5 shadow-panel text-left hover:border-teal/50 active:scale-[0.98] transition-all"
          >
            <Icon className={'h-4 w-4 flex-none ' + (k.key === 'link' ? 'text-amber' : 'text-teal')} />
            <span className="min-w-0">
              <span className="block font-display font-bold text-[13.5px] text-ink leading-none">{k.label}</span>
              <span className="block text-[10.5px] text-faint mt-0.5 whitespace-nowrap">{k.note}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export type LinkState = 'off' | 'pending' | 'ready' | 'failed'

/**
 * Save · Send · Copy link — the three doors out of a finished export, picked
 * by where we are running (Brian, Sep 19: "GIF won't save to phone").
 *
 *  - Save. A browser downloads the blob straight away. The shell cannot (no
 *    DownloadListener), so there Save is the signed storage URL: a FOREIGN
 *    host, which Capacitor hands to the system browser — and Chrome downloads
 *    it like any file on the web.
 *  - Send. Web Share with the LINK where the browser has it, else the
 *    Messages app through an sms: URL (the one door every WebView has), else
 *    the clipboard. A link, not the file: it fits any text and any email.
 *  - Copy link. The short hammertrack.ai/x/<id>, good for 30 days.
 */
export function ExportActions({ filename, blobUrl, link, linkState, linkError, shareText }: {
  filename: string
  /** Object URL of the file, for a browser's direct download. */
  blobUrl?: string | null
  link?: ExportLink | null
  linkState: LinkState
  linkError?: string | null
  /** The sentence that rides beside the link in a text. */
  shareText?: string
}) {
  const [native, setNative] = useState(false)
  useEffect(() => { setNative(isNativeApp()) }, [])
  const [copied, setCopied] = useState(false)
  const ready = linkState === 'ready' && !!link
  // Inside the shell only the storage URL saves anything; in a browser the
  // blob is instant and works offline, with the storage URL as the fallback.
  const saveHref = native ? (ready ? link!.fileUrl : null) : (blobUrl ?? (ready ? link!.fileUrl : null))
  const saveIsBlob = !native && !!blobUrl

  const send = async () => {
    if (!ready) return
    const how = await deliverLink(link!.url, shareText ?? filename, filename)
    if (how === 'copied') toast('Link copied — paste it into a text or an email.', { variant: 'success' })
    else if (how === 'none') toast('No share sheet here — use Copy link.', { variant: 'error' })
  }
  const copy = async () => {
    if (!ready) return
    if (await copyText(link!.url)) { setCopied(true); setTimeout(() => setCopied(false), 1800) }
    else toast('Could not copy — press and hold the link to copy it.', { variant: 'error' })
  }

  const btn = 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold disabled:opacity-40'
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {saveHref ? (
          <a
            href={saveHref}
            {...(saveIsBlob ? { download: filename } : { rel: 'noopener' })}
            className={btn + ' border border-navy-700 bg-navy-950 text-ink'}
          >
            <Download className="h-4 w-4" /> Save
          </a>
        ) : (
          <button type="button" disabled className={btn + ' border border-navy-700 bg-navy-950 text-ink'}>
            <Download className="h-4 w-4" /> {linkState === 'pending' ? 'Getting link…' : 'Save'}
          </button>
        )}
        <button type="button" onClick={send} disabled={!ready} className={btn + ' bg-amber text-[#1a1100] font-display font-bold'}>
          <Send className="h-4 w-4" /> Send
        </button>
        <button type="button" onClick={copy} disabled={!ready} className={btn + ' border border-navy-700 bg-navy-950 text-ink'}>
          <Link2 className="h-4 w-4" /> {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <p className="text-[11.5px] text-faint leading-snug min-h-[1em]">
        {linkState === 'pending' && 'Making a link you can text…'}
        {ready && (
          <>
            <span className="font-mono text-ink break-all">{link!.url.replace(/^https?:\/\//, '')}</span>
            {' '}· anyone with the link · 30 days
          </>
        )}
        {linkState === 'failed' && (
          <span className="text-amber">
            {linkError ?? 'No link this time.'}{!native && blobUrl ? ' Save still works here.' : ''}
          </span>
        )}
        {linkState === 'off' && native && 'Links need a signed-in company — press and hold the picture to save it.'}
      </p>
    </div>
  )
}

/**
 * What happened to the file. An image gets SHOWN, and every file gets the
 * Save · Send · Copy link row — the row is what works inside the app.
 */
export function ExportResult({ open, onClose, title, imageUrl, how, error, filename, blobUrl, link, linkState = 'off', linkError }: {
  open: boolean
  onClose: () => void
  title: string
  /** Present for PNG/GIF: the picture itself. */
  imageUrl?: string | null
  how?: DeliveryHow | null
  error?: string | null
  filename?: string
  /** The file as an object URL — a browser's direct Save. */
  blobUrl?: string | null
  link?: ExportLink | null
  linkState?: LinkState
  linkError?: string | null
}) {
  if (!open) return null

  const line = error
    ? error
    : how === 'shared' ? 'Sent.'
    : how === 'cancelled' ? 'Closed without sending — it is still here.'
    : how === 'downloaded' ? 'Saved to your downloads.'
    : null

  return (
    <div className="fixed inset-0 z-[84] flex items-end md:items-center justify-center bg-navy-950/60" onClick={onClose}>
      <div
        className="w-full md:max-w-lg bg-navy-900 border border-navy-700 rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[calc(88dvh-var(--ht-safe-bottom,0px))] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-navy-800">
          <h2 className="font-display font-bold text-[15px] text-ink flex-1">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="grid place-items-center w-8 h-8 rounded-full bg-navy-800 border border-navy-700 text-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={title} className="w-full rounded-xl border border-navy-700" />
          )}
          {line && <p className={'text-[12.5px] ' + (error ? 'text-alert' : 'text-faint')}>{line}</p>}
          {filename && !error && <p className="font-mono text-[11px] text-faint truncate">{filename}</p>}
          {!error && filename && (blobUrl || link || linkState !== 'off') && (
            <ExportActions
              filename={filename}
              blobUrl={blobUrl}
              link={link}
              linkState={linkState}
              linkError={linkError}
              shareText={`${title} from HammerTrack`}
            />
          )}
          {imageUrl && (
            <p className="text-[11.5px] text-faint leading-snug">
              You can also press and hold the picture to save it to your photos.
            </p>
          )}
        </div>

        <div className="p-4 pt-2 pb-[calc(1rem+var(--ht-safe-bottom,0px))] border-t border-navy-800">
          <button type="button" onClick={onClose}
            className="w-full rounded-xl border border-navy-700 text-muted py-3 text-sm font-semibold hover:text-ink">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
