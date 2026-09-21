'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, X, Search, Loader2, Crown } from 'lucide-react'
import { listViewAsTargetsAction, viewAsAction, type ViewAsTarget } from '@/lib/actions/viewas'
import { toast } from '@/components/ui/feedback'

/**
 * "View as" at the top of the app (Brian, Sep 21: "Add 'view as' somewhere
 * at the top. Want to make sure what is visible and what is not for
 * people"). One picker, three doors — the map's account menu, the desktop
 * sidebar header and the phone's More drawer — so the owner can check what
 * a teammate sees without going to /team first.
 *
 * The list is what the caller may preview (people they outrank; a
 * Prospective Client only for the Master, 118). Picking one sets the
 * read-only preview cookie and opens the map as that person; the amber
 * banner above every page is the way back.
 */
export function ViewAsPicker({ variant, onDone }: { variant: 'menu' | 'sidebar' | 'sidebar-icon' | 'drawer'; onDone?: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<ViewAsTarget[] | null>(null)
  const [q, setQ] = useState('')
  const [pending, start] = useTransition()

  useEffect(() => {
    if (!open || targets) return
    let alive = true
    listViewAsTargetsAction().then((r) => { if (alive) setTargets(r.ok ? r.targets : []) }).catch(() => { if (alive) setTargets([]) })
    return () => { alive = false }
  }, [open, targets])

  const pick = (t: ViewAsTarget) => start(async () => {
    const res = await viewAsAction(t.id)
    if (!res.ok) { toast(res.error ?? 'Could not start the preview.', { variant: 'error' }); return }
    setOpen(false)
    onDone?.()
    router.push('/map')
    router.refresh()
  })

  const needle = q.trim().toLowerCase()
  const shown = (targets ?? []).filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.roleLabel.toLowerCase().includes(needle))
  // Group by role, ladder order — the list reads like the team page.
  const groups = Array.from(shown.reduce((m, t) => { const k = t.roleLabel; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); return m }, new Map<string, ViewAsTarget[]>()).entries())

  const trigger = (() => {
    switch (variant) {
      case 'menu':
        return (
          <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-semibold text-ink hover:bg-navy-800 transition-colors text-left">
            <Eye className="h-4 w-4 text-amber" /> View as…
          </button>
        )
      case 'sidebar':
        return (
          <button type="button" onClick={() => setOpen(true)} title="See the app exactly as a teammate does" className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-2 py-1 text-[11px] font-semibold text-amber hover:bg-amber/20 transition-colors">
            <Eye className="h-3.5 w-3.5" /> View as…
          </button>
        )
      case 'sidebar-icon':
        return (
          <button type="button" onClick={() => setOpen(true)} title="View as…" aria-label="View the app as a teammate" className="grid place-items-center w-9 h-9 rounded-lg border border-amber/40 bg-amber/10 text-amber hover:bg-amber/20 transition-colors">
            <Eye className="h-4 w-4" />
          </button>
        )
      case 'drawer':
        return (
          <button type="button" onClick={() => setOpen(true)} className="col-span-2 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium text-amber bg-amber/10 border border-amber/30 hover:bg-amber/20">
            <Eye className="h-4 w-4" /> View the app as a teammate
          </button>
        )
    }
  })()

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[90] flex items-end md:items-center md:justify-center bg-navy-950/60 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="View the app as a teammate"
            onClick={(e) => e.stopPropagation()}
            className="w-full md:w-[420px] max-h-[calc(88dvh-var(--ht-safe-bottom,0px))] flex flex-col rounded-t-2xl md:rounded-2xl bg-navy-900 border border-navy-700 shadow-panel"
            style={{ paddingBottom: 'var(--ht-safe-bottom, 0px)' }}
          >
            <div className="flex items-center gap-2 px-4 pt-3.5 pb-2 border-b border-navy-800">
              <Eye className="h-4 w-4 text-amber flex-none" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">View the app as…</p>
                <p className="text-[11.5px] text-faint leading-snug">Exactly what this person sees — pages, machines, dollars. Read-only; the amber bar brings you back.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid place-items-center min-h-11 min-w-11 rounded-lg text-faint hover:text-ink"><X className="h-4 w-4" /></button>
            </div>
            {(targets?.length ?? 0) > 6 && (
              <div className="px-4 pt-2.5">
                <label className="flex items-center gap-2 rounded-lg border border-navy-700 bg-navy-950 px-2.5">
                  <Search className="h-3.5 w-3.5 text-faint" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or role" className="w-full bg-transparent py-2 text-[13px] text-ink outline-none placeholder:text-faint" />
                </label>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-2 py-2 overscroll-contain">
              {targets === null && <p className="px-3 py-6 text-center text-[12.5px] text-faint"><Loader2 className="inline h-4 w-4 animate-spin motion-reduce:animate-none mr-1.5" />Loading the team…</p>}
              {targets !== null && shown.length === 0 && (
                <p className="px-3 py-6 text-center text-[12.5px] text-faint">{targets.length === 0 ? 'Nobody to preview yet — invite a teammate on the Team page first.' : 'No one matches.'}</p>
              )}
              {groups.map(([label, list]) => (
                <div key={label} className="mb-1.5">
                  <p className="px-3 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{label}</p>
                  {list.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      disabled={pending}
                      onClick={() => pick(t)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-navy-800 disabled:opacity-60 min-h-11"
                    >
                      <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-navy-800 text-[12px] font-bold text-muted">{(t.name || '?').slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink">{t.name}</span>
                        {t.note && <span className="block truncate text-[11px] text-faint">{t.note}</span>}
                      </span>
                      {t.masterOnly && <Crown className="h-3.5 w-3.5 flex-none text-amber" aria-label="Only you can see this person" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
