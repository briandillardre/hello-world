'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Download, Share2, X } from 'lucide-react'
import {
  GIF_SIZES, GIF_FRAMES, fitSize, framePlan, frameDelayMs, estimateMb,
  encodeGif, gifFilename, MMS_LIMIT_MB, type GifSizeKey, type GifFrame,
} from '@/lib/map-gif'

/**
 * Record the replay as an animated GIF (Brian, Sep 12: "need a gif creator
 * within this as an option also").
 *
 * The PDF button gives someone a dated still. This gives them the day: the
 * truck leaving the yard, working the site, coming back — in a file that
 * plays by itself in a text message with nothing to open and nobody to log
 * in. Frames come from the MAP canvas only, so the timeline, the rails and
 * this sheet are never in the picture.
 *
 * The work happens a frame at a time with a yield between each, because a
 * 90-frame capture that blocks the main thread is a frozen phone — and the
 * person watching needs to see it moving to believe it is working.
 */
export function GifRecorder({ open, onClose, grabFrameAt, rangeLabel, companyName }: {
  open: boolean
  onClose: () => void
  /** Put the replay at 0..1 of the window, let it settle, return a frame. */
  grabFrameAt: (t: number) => Promise<string>
  rangeLabel: string
  companyName?: string | null
}) {
  const [seconds, setSeconds] = useState(6)
  const [frames, setFrames] = useState<number>(45)
  const [size, setSize] = useState<GifSizeKey>('medium')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<'capture' | 'encode'>('capture')
  const [done, setDone] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [out, setOut] = useState<{ url: string; blob: Blob; kb: number } | null>(null)
  const [aspect, setAspect] = useState(16 / 9)
  const cancelRef = useRef(false)
  const urlRef = useRef<string | null>(null)

  // A blob URL outlives the component unless it is revoked — and a handful of
  // un-revoked GIFs is real memory on a phone.
  const clearOut = useCallback(() => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    setOut(null)
  }, [])
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  useEffect(() => { if (!open) { cancelRef.current = true; clearOut(); setErr(null); setBusy(false) } }, [open, clearOut])

  const px = GIF_SIZES.find((s) => s.key === size)!.px
  const estMb = estimateMb(px, frames, aspect)

  const record = async () => {
    if (busy) return
    cancelRef.current = false
    clearOut()
    setErr(null); setBusy(true); setPhase('capture'); setDone(0)
    try {
      const plan = framePlan(frames)
      const scratch = document.createElement('canvas')
      const ctx = scratch.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('This phone would not give us a canvas to draw on.')
      const grabbed: GifFrame[] = []

      for (let i = 0; i < plan.length; i++) {
        if (cancelRef.current) { setBusy(false); return }
        const dataUrl = await grabFrameAt(plan[i])
        const img = await loadImage(dataUrl)
        if (i === 0) {
          const fit = fitSize(img.width, img.height, px)
          scratch.width = fit.w
          scratch.height = fit.h
          setAspect(img.width / img.height)
        }
        ctx.drawImage(img, 0, 0, scratch.width, scratch.height)
        const frame = ctx.getImageData(0, 0, scratch.width, scratch.height)
        grabbed.push({ data: frame.data, width: scratch.width, height: scratch.height })
        setDone(i + 1)
        await yieldToUi()
      }
      if (cancelRef.current) { setBusy(false); return }

      setPhase('encode'); setDone(0)
      const blob = await encodeGif(grabbed, frameDelayMs(seconds, grabbed.length), async (n) => {
        setDone(n)
        await yieldToUi()
      })
      if (cancelRef.current) { setBusy(false); return }
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      setOut({ url, blob, kb: Math.round(blob.size / 1024) })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not make the GIF.')
    } finally {
      setBusy(false)
    }
  }

  const name = gifFilename(`${companyName ?? 'HammerTrack'} ${rangeLabel}`)

  const share = async () => {
    if (!out) return
    const file = new File([out.blob], name, { type: 'image/gif' })
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${rangeLabel} — ${companyName ?? 'HammerTrack'}` })
        return
      }
    } catch { /* a cancelled share is not an error */ return }
    setErr('This phone cannot share files directly — use Save and attach it.')
  }

  if (!open) return null
  const total = phase === 'capture' ? frames : frames
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="fixed inset-0 z-[82] flex items-end md:items-center justify-center bg-navy-950/60" onClick={busy ? undefined : onClose}>
      <div
        className="w-full md:max-w-md bg-navy-900 border border-navy-700 rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[calc(88dvh-var(--ht-safe-bottom,0px))] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-navy-800">
          <Clapperboard className="h-4 w-4 text-teal" />
          <h2 className="font-display font-bold text-[15px] text-ink flex-1">Record a GIF</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
            className="grid place-items-center w-8 h-8 rounded-full bg-navy-800 border border-navy-700 text-faint hover:text-ink disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {out ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={out.url} alt="The recorded map replay" className="w-full rounded-xl border border-navy-700" />
              <p className="text-[12px] text-faint font-mono">
                {frames} frames · {seconds}s · {out.kb > 1024 ? `${(out.kb / 1024).toFixed(1)} MB` : `${out.kb} KB`}
                {out.kb / 1024 > MMS_LIMIT_MB && <span className="text-amber"> · may be too big to text</span>}
              </p>
            </>
          ) : (
            <>
              <p className="text-[12.5px] text-muted leading-snug">
                Plays the <span className="text-ink font-semibold">{rangeLabel}</span> replay and records the map into
                a file that moves by itself in a text or an email. Only the map is in the picture — no buttons, no timeline.
              </p>

              <Row label="How long it plays">
                {[4, 6, 10, 15].map((s) => (
                  <Chip key={s} on={seconds === s} onClick={() => setSeconds(s)}>{s}s</Chip>
                ))}
              </Row>
              <Row label="Smoothness">
                {GIF_FRAMES.map((f) => (
                  <Chip key={f} on={frames === f} onClick={() => setFrames(f)}>{f}</Chip>
                ))}
              </Row>
              <Row label="Size">
                {GIF_SIZES.map((s) => (
                  <Chip key={s.key} on={size === s.key} onClick={() => setSize(s.key)}>{s.label}</Chip>
                ))}
              </Row>
              <p className="text-[11.5px] text-faint">
                About {estMb < 1 ? `${Math.round(estMb * 1024)} KB` : `${estMb.toFixed(1)} MB`} ·{' '}
                {GIF_SIZES.find((s) => s.key === size)!.note}
                {estMb > MMS_LIMIT_MB && <span className="text-amber"> · bigger than most carriers will text</span>}
              </p>
            </>
          )}

          {busy && (
            <div className="space-y-1.5">
              <div className="h-2 rounded-full bg-navy-800 overflow-hidden">
                <div className="h-full bg-teal transition-[width] duration-150" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11.5px] font-mono text-faint">
                {phase === 'capture' ? `Recording the map… frame ${done} of ${frames}` : `Building the file… ${pct}%`}
              </p>
            </div>
          )}

          {err && <p className="text-[12px] text-alert">{err}</p>}
        </div>

        <div className="p-4 pt-2 pb-[calc(1rem+var(--ht-safe-bottom,0px))] border-t border-navy-800 flex gap-2">
          {out ? (
            <>
              <button type="button" onClick={() => { clearOut(); setErr(null) }}
                className="rounded-xl border border-navy-700 text-muted py-3 px-4 text-sm font-semibold hover:text-ink">
                Again
              </button>
              <a href={out.url} download={name}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-navy-700 bg-navy-950 text-ink py-3 text-sm font-semibold">
                <Download className="h-4 w-4" /> Save
              </a>
              <button type="button" onClick={share}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3">
                <Share2 className="h-4 w-4" /> Send
              </button>
            </>
          ) : busy ? (
            <button type="button" onClick={() => { cancelRef.current = true }}
              className="flex-1 rounded-xl border border-alert/40 bg-alert/15 text-alert py-3 text-sm font-semibold">
              Stop
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose}
                className="flex-1 rounded-xl border border-navy-700 text-muted py-3 text-sm font-semibold hover:text-ink">
                Cancel
              </button>
              <button type="button" onClick={record}
                className="flex-[2] rounded-xl bg-amber text-[#1a1100] font-display font-bold py-3">
                Record
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-[9px] uppercase tracking-wider text-faint">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={'rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ' +
        (on ? 'bg-teal/15 border-teal/50 text-teal' : 'bg-navy-950 border-navy-700 text-muted hover:text-ink')}>
      {children}
    </button>
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('A frame did not come back from the map.'))
    img.src = src
  })
}

/** Hand the phone back to the browser so the progress bar actually paints. */
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0))
