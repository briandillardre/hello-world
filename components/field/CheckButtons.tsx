'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, AlertTriangle } from 'lucide-react'
import { addEquipmentCheckAction } from '@/lib/actions/fieldops'
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
  const [error, setError] = useState<string | null>(null)

  const lastOf = (key: string) => checks.find((c) => c.check_type === key)?.created_at ?? null
  const ageDays = (iso: string | null) =>
    iso === null ? null : Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

  const tap = async (key: string) => {
    if (busy) return
    setBusy(key)
    setError(null)
    const res = await addEquipmentCheckAction(assetId, key)
    setBusy(null)
    if (!res.ok) { setError(res.error ?? 'Failed — try again'); return }
    setDone(key)
    setTimeout(() => setDone(null), 1800)
    router.refresh()
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
                : overdue || never
                  ? 'bg-alert/10 border-alert/40 hover:border-alert'
                  : 'bg-navy-900 border-navy-700 hover:border-teal/50')
            }
          >
            <span className="text-left">
              <span className="block font-display font-bold text-[15px] text-ink">
                {done === key ? 'Logged ✓' : label}
              </span>
              <span className={'block text-[11.5px] font-mono ' + (overdue || never ? 'text-alert' : 'text-faint')}>
                {never ? 'never logged' : age === 0 ? 'done today' : `${age}d ago`}
                {(overdue || never) && ' · DUE'}
              </span>
            </span>
            {done === key
              ? <Check className="h-6 w-6 text-teal" />
              : (overdue || never)
                ? <AlertTriangle className="h-5 w-5 text-alert" />
                : <Check className="h-5 w-5 text-faint" />}
          </button>
        )
      })}
      {error && <p className="text-[12.5px] text-alert">{error}</p>}

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
