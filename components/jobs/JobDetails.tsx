'use client'

/**
 * The job's facts: the contract (customer, their number, the owner, contract
 * number and date, scope, exclusions, types, retainage, bonded), the dates and
 * the people. Dollars show and save only for a login that can see costs.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import {
  BILLING_TYPES, BILLING_TYPE_WORDS, CONTRACT_TYPES, CONTRACT_TYPE_WORDS, PROJECT_TYPES, RISKS,
  type JobFields, type JobMoney,
} from '@/lib/jobs/job'
import type { Job, Member } from '@/lib/db/jobs'
import { saveJobAction, saveJobMoneyAction } from '@/lib/actions/jobs'
import { moneyFull } from '@/lib/projects'

const fmtDay = (d: string | null) => {
  if (!d) return null
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const TEXT_KEYS = ['customer', 'customerJobNo', 'ownerName', 'contractNo', 'contractDate', 'scope', 'exclusions', 'projectType', 'contractType', 'billingType', 'risk',
  'bidDue', 'awardDate', 'ntpDate', 'startDate', 'targetCompletion', 'actualCompletion', 'pmId', 'superId', 'address', 'city', 'county', 'state', 'zip', 'notes'] as const
type Draft = Record<(typeof TEXT_KEYS)[number], string> & { bid: string; contract: string; ret: string; stored: string; bonded: boolean }

function draftOf(job: Job, money: JobMoney | null, members: Member[]): Draft {
  const d = Object.fromEntries(TEXT_KEYS.map((k) => [k, (job[k as keyof JobFields] as string | null) ?? ''])) as unknown as Draft
  // Someone who has left the team can't be picked again — the form starts at "—" for them.
  for (const k of ['pmId', 'superId'] as const) if (d[k] && !members.some((m) => m.id === d[k])) d[k] = ''
  d.bid = money?.bidAmount != null ? String(money.bidAmount) : ''
  d.contract = money?.contractAmount != null ? String(money.contractAmount) : ''
  d.ret = String(money?.retainagePct ?? 10)
  d.stored = String(money?.storedRetainagePct ?? 10)
  d.bonded = !!money?.bonded
  return d
}

/** A labelled field. Module-level on purpose: a component made inside render remounts its input on every keystroke (focus lost). */
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-0.5"><span className="text-[11.5px] text-faint">{label}</span>{children}</label>
}

export function JobDetails({ zoneId, job, money, members, canEdit, canCosts }: {
  zoneId: string; job: Job; money: JobMoney | null; members: Member[]; canEdit: boolean; canCosts: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [d, setD] = useState<Draft>(() => draftOf(job, money, members))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? 'Someone who left' : null)

  async function save() {
    setBusy(true); setErr(null)
    const patch: Record<string, string> = {}
    for (const k of TEXT_KEYS) patch[k] = d[k]
    const r = await saveJobAction(zoneId, patch).catch(() => null)
    if (!r?.ok) { setBusy(false); setErr(r && !r.ok ? r.error : 'Couldn’t save — try again.'); return }
    if (canCosts) {
      const m = await saveJobMoneyAction(zoneId, { bidAmount: d.bid, contractAmount: d.contract, retainagePct: d.ret, storedRetainagePct: d.stored, bonded: d.bonded }).catch(() => null)
      if (!m?.ok) { setBusy(false); setErr(m && !m.ok ? m.error : 'Couldn’t save the dollars — try again.'); return }
    }
    setBusy(false); setEditing(false); router.refresh()
  }

  if (!editing) {
    const rows: [string, string | null][] = [
      ['Customer', job.customer], ['Their job number', job.customerJobNo], ['Owner', job.ownerName],
      ['Contract', [job.contractNo, fmtDay(job.contractDate)].filter(Boolean).join(' · ') || null],
      ['Type', [job.projectType, job.contractType ? CONTRACT_TYPE_WORDS[job.contractType] : null, job.billingType ? BILLING_TYPE_WORDS[job.billingType] : null].filter(Boolean).join(' · ') || null],
      ...(canCosts && money ? [
        ['Bid', money.bidAmount != null ? moneyFull(money.bidAmount) : null] as [string, string | null],
        ['Contract amount', money.contractAmount != null ? moneyFull(money.contractAmount) : null] as [string, string | null],
        ['Retainage', `${money.retainagePct}% of work${money.storedRetainagePct !== money.retainagePct ? ` · ${money.storedRetainagePct}% of stored material` : ''}${money.bonded ? ' · bonded' : ''}`] as [string, string | null],
      ] : []),
      ['Risk', job.risk ? job.risk[0].toUpperCase() + job.risk.slice(1) : null],
      ['Bid due', fmtDay(job.bidDue)], ['Awarded', fmtDay(job.awardDate)], ['Notice to proceed', fmtDay(job.ntpDate)],
      ['Start', fmtDay(job.startDate)], ['Target completion', fmtDay(job.targetCompletion)], ['Completed', fmtDay(job.actualCompletion)],
      ['Project manager', nameOf(job.pmId)], ['Superintendent / foreman', nameOf(job.superId)],
      ['Address', [job.address, job.city, job.county ? `${job.county} County` : null, job.state, job.zip].filter(Boolean).join(', ') || null],
    ]
    const shown = rows.filter(([, v]) => v)
    return (
      <div className="space-y-2 text-[12.5px]">
        {job.scope && <p className="text-ink whitespace-pre-wrap"><span className="text-faint">Scope · </span>{job.scope}</p>}
        {job.exclusions && <p className="text-muted whitespace-pre-wrap"><span className="text-faint">Exclusions · </span>{job.exclusions}</p>}
        {shown.length > 0 ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {shown.map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0"><dt className="text-faint flex-none">{k}</dt><dd className="text-ink truncate">{v}</dd></div>
            ))}
          </dl>
        ) : <p className="text-faint">Nothing written down yet — the customer, the contract, the dates and who runs it go here.</p>}
        {job.notes && <p className="text-muted whitespace-pre-wrap"><span className="text-faint">Notes · </span>{job.notes}</p>}
        {canEdit && <button type="button" onClick={() => { setD(draftOf(job, money, members)); setEditing(true) }} className="inline-flex items-center gap-1 text-teal"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
      </div>
    )
  }

  const f = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value })
  const inp = 'w-full rounded-lg border border-navy-700 bg-navy-950 px-2 py-1.5 text-ink outline-none text-[13px]'
  return (
    <div className="space-y-3 text-[12.5px]">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <L label="Customer (GC or owner who hires you)"><input className={inp} value={d.customer} onChange={f('customer')} maxLength={120} /></L>
        <L label="Their job number"><input className={inp} value={d.customerJobNo} onChange={f('customerJobNo')} maxLength={60} /></L>
        <L label="Owner (whose project it is)"><input className={inp} value={d.ownerName} onChange={f('ownerName')} maxLength={120} /></L>
        <L label="Contract / subcontract / PO number"><input className={inp} value={d.contractNo} onChange={f('contractNo')} maxLength={60} /></L>
        <L label="Contract date"><input type="date" className={inp} value={d.contractDate} onChange={f('contractDate')} /></L>
        <L label="Project type">
          <select className={inp} value={d.projectType} onChange={f('projectType')}>
            <option value="">—</option>
            {PROJECT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            {d.projectType && !PROJECT_TYPES.includes(d.projectType) && <option value={d.projectType}>{d.projectType}</option>}
          </select>
        </L>
        <L label="Contract type">
          <select className={inp} value={d.contractType} onChange={f('contractType')}>
            <option value="">—</option>{CONTRACT_TYPES.map((t) => <option key={t} value={t}>{CONTRACT_TYPE_WORDS[t]}</option>)}
          </select>
        </L>
        <L label="Billing">
          <select className={inp} value={d.billingType} onChange={f('billingType')}>
            <option value="">—</option>{BILLING_TYPES.map((t) => <option key={t} value={t}>{BILLING_TYPE_WORDS[t]}</option>)}
          </select>
        </L>
      </div>
      <L label="Scope — what the contract is for"><textarea className={inp} rows={2} value={d.scope} onChange={f('scope')} maxLength={1000} /></L>
      <L label="Exclusions"><textarea className={inp} rows={2} value={d.exclusions} onChange={f('exclusions')} maxLength={2000} /></L>
      {canCosts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <L label="Bid ($)"><input inputMode="decimal" className={inp} value={d.bid} onChange={f('bid')} /></L>
          <L label="Contract ($)"><input inputMode="decimal" className={inp} value={d.contract} onChange={f('contract')} /></L>
          <L label="Retainage on work (%)"><input inputMode="decimal" className={inp} value={d.ret} onChange={f('ret')} /></L>
          <L label="On stored material (%)"><input inputMode="decimal" className={inp} value={d.stored} onChange={f('stored')} /></L>
          <label className="col-span-2 inline-flex items-center gap-1.5 text-muted"><input type="checkbox" checked={d.bonded} onChange={(e) => setD({ ...d, bonded: e.target.checked })} /> Bonded job</label>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <L label="Bid due"><input type="date" className={inp} value={d.bidDue} onChange={f('bidDue')} /></L>
        <L label="Awarded"><input type="date" className={inp} value={d.awardDate} onChange={f('awardDate')} /></L>
        <L label="Notice to proceed"><input type="date" className={inp} value={d.ntpDate} onChange={f('ntpDate')} /></L>
        <L label="Start"><input type="date" className={inp} value={d.startDate} onChange={f('startDate')} /></L>
        <L label="Target completion"><input type="date" className={inp} value={d.targetCompletion} onChange={f('targetCompletion')} /></L>
        <L label="Completed"><input type="date" className={inp} value={d.actualCompletion} onChange={f('actualCompletion')} /></L>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <L label="Project manager">
          <select className={inp} value={d.pmId} onChange={f('pmId')}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </L>
        <L label="Superintendent / foreman">
          <select className={inp} value={d.superId} onChange={f('superId')}><option value="">—</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </L>
        <L label="Risk">
          <select className={inp} value={d.risk} onChange={f('risk')}><option value="">—</option>{RISKS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select>
        </L>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="col-span-2"><L label="Address"><input className={inp} value={d.address} onChange={f('address')} maxLength={200} /></L></div>
        <L label="City"><input className={inp} value={d.city} onChange={f('city')} maxLength={80} /></L>
        <L label="County"><input className={inp} value={d.county} onChange={f('county')} maxLength={80} /></L>
        <div className="grid grid-cols-2 gap-2">
          <L label="State"><input className={inp} value={d.state} onChange={f('state')} maxLength={40} /></L>
          <L label="ZIP"><input className={inp} value={d.zip} onChange={f('zip')} maxLength={12} /></L>
        </div>
      </div>
      <L label="Notes"><textarea className={inp} rows={2} value={d.notes} onChange={f('notes')} maxLength={4000} /></L>
      {err && <p className="text-red-300">{err}</p>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl bg-amber px-3 py-1.5 font-semibold text-navy-950 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-navy-700 px-3 py-1.5 text-muted">Cancel</button>
      </div>
    </div>
  )
}
