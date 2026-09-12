'use client'

import { useEffect, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, Clapperboard, X } from 'lucide-react'
import { EXPORT_KINDS, type ExportKind, type DeliveryHow } from '@/lib/map-export'

/**
 * The export flyout (Brian, Sep 12: "when you click button i should see 3
 * options to the left — PDF, PNG, and GIF").
 *
 * One rail button, three answers, opening LEFT of the rail so a thumb on the
 * right edge never covers the choice it is about to make.
 *
 * It also exists because the old PDF button looked broken. It was not — it
 * built the file and then handed it to a door that does not exist inside the
 * app (see lib/map-export.ts). Every export now ENDS somewhere visible: the
 * picture on screen with a press-and-hold hint, or a plain sentence saying
 * what happened.
 */

const ICONS: Record<ExportKind, typeof FileText> = { pdf: FileText, png: ImageIcon, gif: Clapperboard }

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
      aria-label="Export this view"
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
            <Icon className="h-4 w-4 text-teal flex-none" />
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

/**
 * What happened to the file. An image gets SHOWN — inside the app that is the
 * only reliable way to save one (press and hold gives Android's own Save /
 * Share menu, no native plugin and no store release needed).
 */
export function ExportResult({ open, onClose, title, imageUrl, how, error, filename }: {
  open: boolean
  onClose: () => void
  title: string
  /** Present for PNG/GIF: the picture itself. */
  imageUrl?: string | null
  how?: DeliveryHow | null
  error?: string | null
  filename?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (!open) setCopied(false) }, [open])
  if (!open) return null

  const line = error
    ? error
    : how === 'shared' ? 'Sent.'
    : how === 'cancelled' ? 'Closed without sending — it is still here.'
    : how === 'downloaded' ? 'Saved to your downloads.'
    : how === 'blocked' ? 'This app has nowhere to put a file, so here it is.'
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
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={title} className="w-full rounded-xl border border-navy-700" />
              <p className="text-[12.5px] text-muted leading-snug">
                <span className="text-ink font-semibold">Press and hold the picture</span> to save it to your photos
                or send it in a text.
              </p>
            </>
          )}
          {line && <p className={'text-[12.5px] ' + (error ? 'text-alert' : 'text-faint')}>{line}</p>}
          {filename && !error && <p className="font-mono text-[11px] text-faint truncate">{filename}</p>}
          {imageUrl && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const blob = await (await fetch(imageUrl)).blob()
                  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
                  setCopied(true)
                } catch { setCopied(false) }
              }}
              className="text-[12px] font-semibold text-teal hover:text-ink"
            >
              {copied ? 'Copied' : 'Copy to clipboard'}
            </button>
          )}
        </div>

        <div className="p-4 pt-2 pb-[calc(1rem+var(--ht-safe-bottom,0px))] border-t border-navy-800">
          <button type="button" onClick={onClose}
            className="w-full rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
