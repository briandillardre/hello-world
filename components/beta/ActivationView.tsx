'use client'

/** The founder's activation funnel: every company's first-week milestones, stalled ones on top. */
import { Activity } from 'lucide-react'
import { MILESTONES, type CompanyActivation, type MilestoneKey } from '@/lib/beta/activation'
import { BetaPage, Notice, StatePill, card, fmtDay } from './ui'

export function ActivationView({ rows, funnel }: { rows: CompanyActivation[]; funnel: { key: MilestoneKey; label: string; count: number }[] }) {
  const total = rows.length || 1
  const activated = rows.filter((r) => r.activated).length
  const sorted = [...rows].sort((a, b) => Number(b.stalled) - Number(a.stalled) || String(b.signup).localeCompare(String(a.signup)))
  return (
    <BetaPage title="Activation" icon={<Activity className="h-5 w-5 text-violet-300" />}
      blurb="Did each company get a machine reporting in its first week? Activated = a live fix within 7 days of signing up. Only you see this page.">
      {!rows.length && <Notice tone="info">No companies to show (demo mode).</Notice>}
      {rows.length > 0 && (
        <>
          <div className={`${card} space-y-1.5`}>
            <p className="font-semibold text-ink">{activated} of {rows.length} activated in their first week</p>
            {funnel.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="w-36 flex-none text-muted text-[12px]">{f.label}</span>
                <div className="h-3 flex-1 rounded bg-navy-800 overflow-hidden"><div className="h-full rounded bg-violet-400/70" style={{ width: `${(f.count / total) * 100}%` }} /></div>
                <span className="w-8 text-right text-ink text-[12px]">{f.count}</span>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-navy-800">
            <table className="w-full text-[12px] min-w-[760px]">
              <thead className="bg-navy-900 text-faint"><tr><th className="text-left px-2 py-1.5">Company</th>{MILESTONES.map((m) => <th key={m.key} className="px-1.5">{m.label}</th>)}<th className="text-left px-2">Next</th></tr></thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id} className="border-t border-navy-800 align-top">
                    <td className="px-2 py-1.5"><p className="text-ink">{r.name}</p><p className="text-faint">since {fmtDay(r.signup?.slice(0, 10))}</p>
                      {r.activated ? <StatePill state="ok">activated</StatePill> : r.stalled ? <StatePill state="bad">stalled</StatePill> : <StatePill state="soon">first week</StatePill>}</td>
                    {r.steps.map((s) => <td key={s.key} className="px-1.5 text-center">{s.at ? <span className="text-teal">{s.dayN !== null ? `day ${s.dayN}` : '✓'}</span> : <span className="text-faint">—</span>}</td>)}
                    <td className="px-2 text-muted">{r.next ?? 'Running'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </BetaPage>
  )
}
