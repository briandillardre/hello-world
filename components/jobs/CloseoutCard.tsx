'use client'

/**
 * Closeout that checks itself (migration 156): what still stands between the
 * job and Closed, each line opening the page where it is settled. Closing is
 * one tap once nothing blocks; with something open a Manager may close it
 * anyway, saying why (written on the job with who and when).
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertTriangle, XCircle, Lock } from 'lucide-react'
import type { CloseCheck, CheckKey } from '@/lib/jobs/closeout'
import { setStageAction } from '@/lib/actions/jobs'

const where = (key: CheckKey, zoneId: string, billing: boolean): string | null => {
  switch (key) {
    case 'punch': return `/zones/${zoneId}`
    case 'issues': return `/jobs/${zoneId}/issues`
    case 'cos': case 'final': case 'paid': case 'waiver': return billing ? `/jobs/${zoneId}/billing` : null
    case 'charging': return '/timecards'
    default: return null
  }
}

export function CloseoutCard({ zoneId, checks, closed, closedLine, canEdit, canManage, billing }: {
  zoneId: string; checks: CloseCheck[]; closed: boolean; closedLine: string | null; canEdit: boolean; canManage: boolean; billing: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [why, setWhy] = useState('')
  const blocking = checks.filter((c) => c.level === 'block' && !c.ok)

  async function close() {
    setBusy(true); setErr(null)
    const r = await setStageAction(zoneId, 'closed', null, blocking.length ? why : null).catch(() => null)
    setBusy(false)
    if (!r?.ok) { setErr((r && !r.ok && r.error) || 'Couldn’t close it — try again.'); return }
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900/60 p-3 space-y-2 text-[12.5px]">
      <h2 className="text-ink font-semibold text-[14px] flex items-center gap-1.5"><Lock className="h-4 w-4 text-amber" /> Closeout</h2>
      {closed && closedLine && <p className="text-teal">{closedLine}</p>}
      <ul className="space-y-1">
        {checks.map((c) => {
          const href = c.ok ? null : where(c.key, zoneId, billing)
          const Icon = c.ok ? CheckCircle2 : c.level === 'warn' ? AlertTriangle : XCircle
          const tone = c.ok ? 'text-teal' : c.level === 'warn' ? 'text-amber' : 'text-red-300'
          const body = (
            <span className="min-w-0">
              <span className={c.ok ? 'text-muted' : 'text-ink'}>{c.title}</span>
              {c.detail && <span className="block text-faint">{c.detail}</span>}
            </span>
          )
          return (
            <li key={c.key} className="flex items-start gap-2">
              <Icon className={'h-4 w-4 mt-0.5 flex-none ' + tone} />
              {href ? <Link href={href} className="hover:underline min-w-0">{body}</Link> : body}
            </li>
          )
        })}
      </ul>
      {err && <p className="text-red-300">{err}</p>}
      {!closed && canEdit && (blocking.length === 0 ? (
        <button type="button" disabled={busy} onClick={() => void close()} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy ? 'Closing…' : 'Close the job'}</button>
      ) : canManage ? (
        <div className="space-y-1.5">
          <input value={why} onChange={(e) => setWhy(e.target.value.slice(0, 500))} placeholder="Close it anyway? Say why — e.g. retainage written off, waiver on file in the office" className="w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none" />
          <button type="button" disabled={busy || !why.trim()} onClick={() => void close()} className="rounded-xl border border-amber/60 px-3 py-1.5 font-semibold text-amber disabled:opacity-50">{busy ? 'Closing…' : 'Close it anyway'}</button>
        </div>
      ) : (
        <p className="text-faint">It closes once these are settled — or a Manager can close it anyway with a reason.</p>
      ))}
    </section>
  )
}
