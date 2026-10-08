'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { DEAD_MS } from '@/lib/glance'

export interface DeviceRow {
  key: string
  company: string
  tracker: string
  model: string
  kind: 'obd' | 'battery' | 'tag'
  iccid: string | null
  assetId: string | null
  assetName: string | null
  assetType: string | null
  label: string | null
  lastAt: string | null
  volts: number | null
  battery: number | null
  heardBy: string | null
  heardById: string | null
}

type Status = 'live' | 'quiet' | 'dark' | 'never'
const HOUR = 3_600_000

function statusOf(lastAt: string | null, now: number): Status {
  if (!lastAt) return 'never'
  const age = now - Date.parse(lastAt)
  if (age < HOUR) return 'live'
  if (age < DEAD_MS) return 'quiet'
  return 'dark'
}

const STATUS_CLS: Record<Status, string> = {
  live: 'bg-teal-500/15 text-teal-300 border-teal-500/40',
  quiet: 'bg-amber/15 text-amber border-amber/40',
  dark: 'bg-navy-800 text-faint border-navy-700',
  never: 'bg-red-500/10 text-red-300 border-red-500/30',
}
const KIND_LABEL = { obd: 'OBD', battery: 'Battery', tag: 'Tag' } as const

const fmtAbs = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
function rel(ms: number): string {
  const m = Math.round(ms / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

type SortKey = 'company' | 'tracker' | 'model' | 'asset' | 'last' | 'volts' | 'battery' | 'status'

export function DeviceInventory({ rows, now }: { rows: DeviceRow[]; now: number }) {
  const [q, setQ] = useState('')
  const [company, setCompany] = useState<string>('all')
  const [status, setStatus] = useState<Status | 'all'>('all')
  const [kind, setKind] = useState<DeviceRow['kind'] | 'all'>('all')
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'company', dir: 1 })

  const withStatus = useMemo(() => rows.map((r) => ({ ...r, status: statusOf(r.lastAt, now) })), [rows, now])
  const companies = useMemo(() => Array.from(new Set(rows.map((r) => r.company))).sort(), [rows])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = withStatus.filter((r) =>
      (company === 'all' || r.company === company) &&
      (status === 'all' || r.status === status) &&
      (kind === 'all' || r.kind === kind) &&
      (!needle || [r.company, r.tracker, r.model, r.iccid, r.assetName, r.label, r.heardBy]
        .some((v) => v?.toLowerCase().includes(needle))))
    const val = (r: typeof out[number]): string | number => {
      switch (sort.k) {
        case 'company': return r.company.toLowerCase()
        case 'tracker': return r.tracker
        case 'model': return r.model
        case 'asset': return (r.assetName ?? '~').toLowerCase()
        case 'last': return r.lastAt ? Date.parse(r.lastAt) : -Infinity
        case 'volts': return r.volts ?? -Infinity
        case 'battery': return r.battery ?? -Infinity
        case 'status': return ['live', 'quiet', 'dark', 'never'].indexOf(r.status)
      }
    }
    return out.sort((a, b) => {
      const x = val(a), y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [withStatus, q, company, status, kind, sort])

  const exportCsv = () => {
    const head = ['Company', 'Tracker', 'Model', 'Kind', 'ICCID', 'Installed on', 'Type', 'Label', 'Last check-in', 'Status', 'Truck volts', 'Battery %', 'Heard by']
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [head, ...shown.map((r) => [
      r.company, r.tracker, r.model, KIND_LABEL[r.kind], r.iccid, r.assetName ?? 'In drawer', r.assetType, r.label,
      r.lastAt ?? '', r.status, r.volts?.toFixed(1) ?? '', r.battery ?? '', r.heardBy ?? '',
    ])].map((l) => l.map(esc).join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `hammertrack-devices-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="sticky top-0 z-10 bg-navy-900 px-2 py-1.5 text-left font-semibold whitespace-nowrap border-b border-navy-700">
      <button onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))} className="hover:text-ink">
        {children}{sort.k === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )
  const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-[11px] whitespace-nowrap ${on ? 'border-amber text-amber bg-amber/10' : 'border-navy-700 text-faint'}`

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-[1400px] mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display font-bold text-xl text-ink">Devices — all clients</h1>
            <p className="text-[12.5px] text-faint mt-0.5">Every tracker on every company, live. Founder only.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/board" className="text-[12px] text-amber hover:underline">Control Room</Link>
            <button onClick={exportCsv} className="px-3 py-1.5 rounded-md border border-navy-700 text-[12px] text-ink hover:border-amber">Export CSV</button>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracker, ICCID, asset, label…"
            className="w-full md:max-w-sm rounded-md bg-navy-900 border border-navy-700 px-3 py-1.5 text-[13px] text-ink" />
          <div className="flex gap-1.5 flex-wrap">
            <button className={chip(status === 'all')} onClick={() => setStatus('all')}>All status</button>
            {(['live', 'quiet', 'dark', 'never'] as Status[]).map((s) => (
              <button key={s} className={chip(status === s)} onClick={() => setStatus(s)}>{s}</button>
            ))}
            <span className="w-2" />
            <button className={chip(kind === 'all')} onClick={() => setKind('all')}>All kinds</button>
            {(['obd', 'battery', 'tag'] as const).map((k) => (
              <button key={k} className={chip(kind === k)} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button className={chip(company === 'all')} onClick={() => setCompany('all')}>All companies</button>
            {companies.map((c) => (
              <button key={c} className={chip(company === c)} onClick={() => setCompany(c)}>{c}</button>
            ))}
          </div>
          <div className="text-[11px] font-mono text-faint">{shown.length} of {rows.length} trackers</div>
        </div>

        <div className="mt-2 max-h-[70vh] overflow-auto rounded-md border border-navy-800">
          <table className="min-w-[1100px] w-full text-[12px] text-ink/90">
            <thead className="text-faint">
              <tr>
                <Th k="company">Company</Th>
                <Th k="tracker">Tracker</Th>
                <Th k="model">Model</Th>
                <th className="sticky top-0 z-10 bg-navy-900 px-2 py-1.5 text-left font-semibold border-b border-navy-700">ICCID</th>
                <Th k="asset">Installed on</Th>
                <Th k="last">Last check-in</Th>
                <Th k="status">Status</Th>
                <Th k="volts">Truck V</Th>
                <Th k="battery">Batt %</Th>
                <th className="sticky top-0 z-10 bg-navy-900 px-2 py-1.5 text-left font-semibold border-b border-navy-700">Heard by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="border-b border-navy-800/60 hover:bg-navy-800/40">
                  <td className="px-2 py-1 whitespace-nowrap">{r.company}</td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap">{r.tracker}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.model} <span className="text-faint">· {KIND_LABEL[r.kind]}</span></td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap text-faint">{r.iccid ?? '—'}</td>
                  <td className="px-2 py-1">
                    {r.assetId
                      ? <Link href={`/assets/${r.assetId}`} className="text-amber hover:underline">{r.assetName}</Link>
                      : <span className="text-faint italic">In drawer</span>}
                    {r.assetType && <span className="text-faint"> · {r.assetType}</span>}
                    {r.label && <div className="text-[11px] text-faint">{r.label}</div>}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r.lastAt ? <>{rel(now - Date.parse(r.lastAt))} <span className="text-faint">· {fmtAbs.format(new Date(r.lastAt))}</span></> : '—'}
                  </td>
                  <td className="px-2 py-1"><span className={`px-1.5 py-0.5 rounded border text-[10.5px] ${STATUS_CLS[r.status]}`}>{r.status}</span></td>
                  <td className="px-2 py-1 font-mono">{r.volts != null ? r.volts.toFixed(1) : '—'}</td>
                  <td className="px-2 py-1 font-mono">{r.battery != null ? Math.round(r.battery) : '—'}</td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {r.heardById ? <Link href={`/assets/${r.heardById}`} className="hover:underline">{r.heardBy ?? 'gateway'}</Link> : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
