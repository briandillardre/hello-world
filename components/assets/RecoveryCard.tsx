'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Siren } from 'lucide-react'
import { startRecoveryAction, extendRecoveryAction, stopRecoveryAction } from '@/lib/actions/recovery'
import { NO_REPLY } from '@/lib/action-reply'
import { confirmSheet } from '@/components/ui/feedback'
import { RECOVERY_DAYS } from '@/lib/location-policy'

/**
 * Recovery mode on the asset page (132). Everyone who can see the asset sees
 * the red banner while it runs — who started it and when it ends; Admins and
 * the owner start, extend and stop it, and read the reason. Dates arrive
 * formatted on the server in the viewer's zone (no hydration drift).
 */
export interface RecoveryCardProps {
  assetId: string
  isTool: boolean
  canManage: boolean
  active: { startedByName: string | null; startedText: string; endsText: string; reason: string } | null
  /** The newest anonymous sighting of the tag, when there is one. */
  lastHeard: { whenText: string; exact: boolean } | null
  past: { text: string; reason: string }[]
  /** Arrived from a theft alert's "Start recovery": open the form. */
  startOpen?: boolean
  alertEventId?: string | null
}

export function RecoveryCard({ assetId, isTool, canManage, active, lastHeard, past, startOpen = false, alertEventId = null }: RecoveryCardProps) {
  const router = useRouter()
  const [open, setOpen] = useState(startOpen && canManage && !active)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean; error?: string } | undefined>, after?: () => void) => {
    setErr(null)
    start(async () => {
      const r = await fn()
      if (!r?.ok) { setErr(r?.error ?? NO_REPLY); return }
      after?.()
      router.refresh()
    })
  }

  if (active) {
    return (
      <section id="recovery" className="rounded-xl border border-alert/50 bg-alert/[0.09] p-4 space-y-2" aria-label="Recovery">
        <div className="flex items-center gap-2">
          <Siren className="h-4 w-4 text-alert animate-blink flex-none" />
          <h3 className="font-display font-bold text-sm text-alert">In recovery</h3>
          <span className="ml-auto text-[11.5px] font-semibold text-alert/90">until {active.endsText}</span>
        </div>
        <p className="text-[12.5px] text-ink leading-snug">
          Started by <span className="font-semibold">{active.startedByName ?? 'an Admin'}</span> on {active.startedText}. It ends on its own then unless someone extends it.
        </p>
        <p className="text-[12px] text-muted leading-snug">
          {isTool
            ? 'Crew phones that hear its tag off the clock report the exact spot instead of a rough area — never whose phone heard it.'
            : 'It is marked on the map until it is found. Its own tracker keeps reporting as it always does.'}
        </p>
        {isTool && lastHeard && (
          <p className="text-[12px] text-ink">
            Last heard by a crew phone {lastHeard.whenText}{lastHeard.exact ? ' · exact spot' : ' · rough area'} ·{' '}
            <Link href={`/map?follow=${assetId}`} className="font-semibold text-teal hover:underline">Show on map</Link>
          </p>
        )}
        {canManage && (
          <>
            <p className="text-[12px] text-muted"><span className="text-faint">Why:</span> {active.reason}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button" disabled={pending}
                onClick={() => run(() => extendRecoveryAction(assetId))}
                className="rounded-lg border border-alert/50 px-3 py-1.5 text-[12px] font-semibold text-alert hover:bg-alert/10 disabled:opacity-50"
              >
                Extend {RECOVERY_DAYS} days
              </button>
              <button
                type="button" disabled={pending}
                onClick={async () => {
                  const okd = await confirmSheet({ title: 'Stop recovery?', message: 'Phones go back to reporting only a rough area for this tag off the clock.', confirmLabel: 'Stop — it’s found' })
                  if (okd) run(() => stopRecoveryAction(assetId))
                }}
                className="rounded-lg bg-alert px-3 py-1.5 text-[12px] font-display font-bold text-white hover:brightness-110 disabled:opacity-50"
              >
                Stop — it’s found
              </button>
            </div>
          </>
        )}
        {err && <p className="text-[12px] text-red-400">{err}</p>}
      </section>
    )
  }

  if (!canManage) return null
  return (
    <section id="recovery" className="rounded-xl border border-navy-700 bg-navy-900/60 p-4 space-y-2" aria-label="Recovery">
      <div className="flex items-center gap-2">
        <Siren className="h-4 w-4 text-alert flex-none" />
        <h3 className="font-display font-bold text-sm text-ink">Missing?</h3>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="ml-auto rounded-lg border border-alert/50 px-3 py-1.5 text-[12px] font-semibold text-alert hover:bg-alert/10">
            Start recovery
          </button>
        )}
      </div>
      <p className="text-[12px] text-muted leading-snug">
        {isTool
          ? `For ${RECOVERY_DAYS} days, crew phones that hear its tag off the clock report the exact spot instead of a rough area — never whose phone. `
          : `For ${RECOVERY_DAYS} days it is marked as missing here and on the map. `}
        Everyone who can see this asset sees that it&apos;s in recovery and who started it.
      </p>
      {open && (
        <div className="space-y-2 pt-1">
          <label className="block text-[12px] text-faint" htmlFor="recovery-reason">Why — a few words, kept with the record</label>
          <textarea
            id="recovery-reason" rows={2} maxLength={300} value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Left the yard overnight"
            className="w-full rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-[16px] md:text-[13px] text-ink placeholder:text-faint"
          />
          <div className="flex gap-2">
            <button
              type="button" disabled={pending || reason.trim().length < 3}
              onClick={() => run(() => startRecoveryAction({ assetId, reason, alertEventId }), () => { setOpen(false); setReason('') })}
              className="rounded-lg bg-alert px-3 py-1.5 text-[12px] font-display font-bold text-white hover:brightness-110 disabled:opacity-50"
            >
              {pending ? 'Starting…' : 'Start recovery'}
            </button>
            <button type="button" onClick={() => { setOpen(false); setErr(null) }} className="rounded-lg border border-navy-700 px-3 py-1.5 text-[12px] text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}
      {past.length > 0 && (
        <div className="pt-1 space-y-0.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-faint">Earlier recoveries</p>
          {past.map((p, i) => (
            <p key={i} className="text-[11.5px] text-muted truncate" title={p.reason}>{p.text} · {p.reason}</p>
          ))}
        </div>
      )}
      {err && <p className="text-[12px] text-red-400">{err}</p>}
    </section>
  )
}
