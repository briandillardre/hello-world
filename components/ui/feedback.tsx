'use client'

import { useEffect, useState } from 'react'
import { Check, AlertTriangle, Info, X } from 'lucide-react'

/**
 * App-wide feedback: toasts + a styled confirm sheet, replacing every native
 * alert()/confirm() (Android renders those as a gray system box titled
 * "hammertrack.ai says:" — the single most amateur tell we had, Aug 11).
 *
 * Event-based singletons so ANY component (client comps deep in the map, the
 * asset form, managers) can call toast()/confirmSheet() with no context
 * plumbing. <FeedbackHost /> mounts once in the dashboard layout.
 */

type Variant = 'success' | 'error' | 'info'
interface ToastItem { id: number; msg: string; variant: Variant; undo?: () => void; ttl: number }
interface ConfirmOpts { title: string; message?: string; confirmLabel?: string; destructive?: boolean }
interface ConfirmReq extends ConfirmOpts { resolve: (ok: boolean) => void }

let seq = 1

export function toast(msg: string, opts: { variant?: Variant; undo?: () => void; ttl?: number } = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('ht:toast', {
    detail: { id: seq++, msg, variant: opts.variant ?? 'info', undo: opts.undo, ttl: opts.ttl ?? (opts.undo ? 6000 : 3500) },
  }))
}

/** Styled, promise-based replacement for window.confirm(). */
export function confirmSheet(opts: ConfirmOpts): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent('ht:confirm', { detail: { ...opts, resolve } }))
  })
}

const ICON: Record<Variant, typeof Check> = { success: Check, error: AlertTriangle, info: Info }
const ICON_CLS: Record<Variant, string> = { success: 'text-teal', error: 'text-amber', info: 'text-faint' }

export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null)

  useEffect(() => {
    const onToast = (e: Event) => {
      const t = (e as CustomEvent<ToastItem>).detail
      setToasts((prev) => [...prev.slice(-2), t]) // stack caps at 3
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), t.ttl)
    }
    const onConfirm = (e: Event) => {
      const req = (e as CustomEvent<ConfirmReq>).detail
      // A second confirm while one is open cancels the first — never stack.
      setConfirm((prev) => { prev?.resolve(false); return req })
    }
    window.addEventListener('ht:toast', onToast)
    window.addEventListener('ht:confirm', onConfirm)
    return () => {
      window.removeEventListener('ht:toast', onToast)
      window.removeEventListener('ht:confirm', onConfirm)
    }
  }, [])

  useEffect(() => {
    if (!confirm) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { confirm.resolve(false); setConfirm(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm])

  const settle = (ok: boolean) => { confirm?.resolve(ok); setConfirm(null) }

  return (
    <>
      {/* ── Toast stack — bottom-center, above the mobile bottom nav ── */}
      {toasts.length > 0 && (
        <div className="fixed bottom-[76px] md:bottom-6 left-1/2 -translate-x-1/2 z-[135] flex flex-col items-center gap-2 w-[min(94vw,420px)] pointer-events-none">
          {toasts.map((t) => {
            const Icon = ICON[t.variant]
            return (
              <div key={t.id} className="ht-toast-in pointer-events-auto flex items-center gap-2.5 w-full rounded-xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel pl-3.5 pr-2 py-2.5">
                <Icon className={'h-4 w-4 flex-none ' + ICON_CLS[t.variant]} />
                <span className="flex-1 min-w-0 text-[12.5px] text-ink leading-snug">{t.msg}</span>
                {t.undo && (
                  <button
                    onClick={() => { t.undo?.(); setToasts((prev) => prev.filter((x) => x.id !== t.id)) }}
                    className="flex-none font-display font-bold text-[12px] text-amber px-2 py-1 rounded-lg hover:bg-navy-900"
                  >
                    Undo
                  </button>
                )}
                <button
                  onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  className="flex-none p-1 text-faint hover:text-ink" aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Confirm sheet — bottom sheet on phones, centered card on desktop ── */}
      {confirm && (
        <div
          className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => settle(false)}
        >
          <div
            className="ht-toast-in w-full max-w-sm rounded-2xl bg-navy-950 border border-navy-700 shadow-panel p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog" aria-modal="true" aria-label={confirm.title}
          >
            <p className="font-display font-bold text-[15px] text-ink leading-snug">{confirm.title}</p>
            {confirm.message && <p className="text-[12.5px] text-muted leading-snug">{confirm.message}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => settle(false)}
                className="flex-1 rounded-xl border border-navy-700 px-3 py-2.5 text-[13px] font-semibold text-muted hover:text-ink hover:border-navy-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => settle(true)}
                className={'flex-1 rounded-xl px-3 py-2.5 text-[13px] font-display font-bold transition-colors ' +
                  (confirm.destructive ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-amber text-[#1a1100] hover:bg-amber-600')}
              >
                {confirm.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
