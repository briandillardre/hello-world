'use client'

import { Download } from 'lucide-react'
import type { AssetUtilization } from '@/lib/types'

/** Download the utilization table as CSV — contractors hand this to their
 *  bookkeeper. Pure client-side; no dependency. */
export function ReportsExport({ util, rates }: { util: AssetUtilization[]; rates: number[] }) {
  const download = () => {
    const header = ['Asset', 'Type', 'Active hours', 'Idle hours', 'Miles', 'Hourly rate', 'Billable value', 'Job sites']
    const rows = util.map((u, i) => {
      const rate = rates[i] ?? 0
      const sites = u.job_site_hours.map((s) => `${s.geofence_name} (${s.hours}h)`).join('; ')
      return [
        u.asset_name, u.asset_type, u.engine_hours, u.idle_hours, u.distance_miles,
        rate, Math.round(u.engine_hours * rate), sites,
      ]
    })
    const esc = (v: string | number) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hammertrack-utilization-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={download}
      className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-muted text-sm font-medium px-3 py-2 hover:bg-navy-800 hover:text-ink transition-colors"
    >
      <Download className="h-4 w-4" /> Export CSV
    </button>
  )
}
