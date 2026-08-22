'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, AlertTriangle, CloudOff } from 'lucide-react'
import { addEquipmentCheckAction } from '@/lib/actions/fieldops'
import { enqueue, pending, newIdempotencyKey, type QueueFlushDetail } from '@/lib/offline-queue'
import { toast } from '@/components/ui/feedback'
import { CHECK_TYPES, type EquipmentCheck } from '@/lib/field-types'

/**
 * The QR landing page's giant buttons. One tap = one timestamped record of
 * who did what to the machine. Each button carries its own answer: how long
 * since it was last done, red when past the interval — the sticker tells the
 * operator whether the machine needs attention before they even tap.
 */
export function CheckButtons({ assetId, checks, tz }: {
  assetId: string
  checks: EquipmentCheck[]
  tz: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [savedOffline, setSavedOffline] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [queuedCount, setQueuedCount] = useState(0)

  // Pending-sync count for THIS machine + refresh when the queue drains.
  useEffect(() => {
    const recount = () => setQueuedCount(
      pending('equipment-check').filter((e) => e.payload.assetId === assetId).length
    )
    recount()
    const onFlushed = (e: Event) => {
      const d = (e as CustomEvent<QueueFlushDetail>).detail
      if (d.entry.action !== 'equipment-check' || d.entry.payload.assetId !== assetId) return
      if (d.ok) toast('Back in coverage — machine check synced.', { variant: 'success' })
      else toast(d.error ?? 'A saved check couldn’t sync.', { variant: 'error', ttl: 6000 })
      router.refresh()
    }
    window.addEventListener('ht:queue-changed', recount)
    window.addEventListener('ht:queue-flushed', onFlushed)
    return () => {
      window.removeEventListener('ht:queue-changed', recount)
      window.removeEventListener('ht:queue-flushed', onFlushed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId])

  const lastOf = (key: string) => checks.find((c) => c.check_type === key)?.created_at ?? null
  const ageDays = (iso: string | null) =>
    iso === null ? null : Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

  const tap = async (key: string) => {
    if (busy) return
    setBusy(key)
    setError(null)
    const idem = newIdempotencyKey()
    const saveOffline = () => {
      // Transport failure (dead zone) — never a server "no". Queue the tap.
      const entry = enqueue('equipment-check', { assetId, checkType: key }, idem)
      setBusy(null)
      if (!entry) { setError('No signal — and this phone is blocking offline storage. Try again in coverage.'); return }
      setSavedOffline(key)
      setTimeout(() => setSavedOffline((cur) => (cur === key ? null : cur)), 2600)
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return saveOffline()
    try {
      const res = await addEquipmentCheckAction(assetId, key, '', idem)
      setBusy(null)
      if (!res.ok) { setError(res.error ?? 'Failed — try again'); return } // server said no
      setDone(key)
      setTimeout(() => setDone(null), 1800)
      router.refresh()
    } catch {
      saveOffline()
    }
  }

  return (
    <div className="space-y-2">
      {CHECK_TYPES.map(({ key, label, intervalDays }) => {
        const last = lastOf(key)
        const age = ageDays(last)
        const overdue = age !== null && age > intervalDays
        const never = age === null
        return (
          <button
            key={key}
            onClick={() => tap(key)}
            disabled={busy !== null}
            className={
              'w-full flex items-center justify-between rounded-xl border px-4 py-4 transition disabled:opacity-60 ' +
              (done === key
                ? 'bg-teal/20 border-teal/60'
                : savedOffline === key
                  ? 'bg-amber/15 border-amber/50'
                  : overdue || never
                    ? 'bg-alert/10 border-alert/40 hover:border-alert'
                    : 'bg-navy-900 border-navy-700 hover:border-teal/50')
            }
          >
            <span className="text-left">
              <span className="block font-display font-bold text-[15px] text-ink">
                {done === key ? 'Logged ✓' : savedOffline === key ? 'Saved on your phone' : label}
              </span>
              <span className={'block text-[11.5px] font-mono ' + (savedOffline === key ? 'text-amber' : overdue || never ? 'text-alert' : 'text-faint')}>
                {savedOffline === key
                  ? 'will sync in coverage'
                  : <>{never ? 'never logged' : age === 0 ? 'done today' : `${age}d ago`}{(overdue || never) && ' · DUE'}</>}
              </span>
            </span>
            {done === key
              ? <Check className="h-6 w-6 text-teal" />
              : savedOffline === key
                ? <CloudOff className="h-5 w-5 text-amber" />
                : (overdue || never)
                  ? <AlertTriangle className="h-5 w-5 text-alert" />
                  : <Check className="h-5 w-5 text-faint" />}
          </button>
        )
      })}
      {error && <p className="text-[12.5px] text-alert">{error}</p>}

      {queuedCount > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2.5 text-[12.5px] text-amber leading-snug">
          <CloudOff className="h-4 w-4 flex-none" />
          <span className="flex-1">Saved on your phone — will sync when you&apos;re back in coverage.</span>
          <span className="flex-none rounded-full border border-amber/40 bg-amber/15 px-2 py-0.5 font-mono text-[11px] tabular-nums">{queuedCount}</span>
        </p>
      )}

      {checks.length > 0 && (
        <div className="pt-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint mb-1.5">Recent</p>
          <ul className="space-y-1">
            {checks.slice(0, 10).map((c) => (
              <li key={c.id} className="text-[12px] text-muted flex justify-between gap-2">
                <span>{CHECK_TYPES.find((t) => t.key === c.check_type)?.label ?? c.check_type}</span>
                <span className="font-mono text-faint tabular-nums">
                  {new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(c.created_at))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
