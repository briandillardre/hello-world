'use client'

import { Download } from 'lucide-react'
import type { VehicleScore } from '@/lib/scorecard'
import { fmtClock } from '@/lib/scorecard'

/** Day-by-day CSV of the scorecard — the payroll/bookkeeper cross-check.
 *  One row per vehicle per day; times as wall clocks, hours as decimals. */
export function ScorecardExport({ scores }: { scores: VehicleScore[] }) {
  const download = () => {
    const header = ['Asset', 'Date', 'Workday', 'First move', 'First on site', 'Last move',
      'Working hours', 'Idle hours', 'Miles', 'After-hours miles']
    const rows: (string | number)[][] = []
    for (const s of scores) {
      for (const d of s.days) {
        rows.push([
          s.name, d.day, d.workday ? 'yes' : 'no',
          d.firstMoveMin != null ? fmtClock(d.firstMoveMin) : '',
          d.firstOnSiteMin != null ? fmtClock(d.firstOnSiteMin) : '',
          d.lastMoveMin != null ? fmtClock(d.lastMoveMin) : '',
          Math.round((d.activeMin / 60) * 100) / 100,
          Math.round((d.idleMin / 60) * 100) / 100,
          Math.round(d.miles * 10) / 10,
          Math.round(d.afterHoursMiles * 10) / 10,
        ])
      }
    }
    const esc = (v: string | number) => {
      const t = String(v)
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
    }
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hammertrack-scorecard-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={download}
      className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-muted text-sm font-medium px-3 py-2 hover:bg-navy-800 hover:text-ink transition-colors"
    >
      <Download className="h-4 w-4" /> <span className="hidden sm:inline">Export</span> CSV
    </button>
  )
}
