'use client'

import { useState } from 'react'
import { Download, FileDown, Loader2 } from 'lucide-react'
import type { VehicleScore } from '@/lib/scorecard'
import { fmtClock } from '@/lib/scorecard'

/** Day-by-day CSV + branded PDF of the scorecard — the payroll/bookkeeper
 *  cross-check and the print-and-hand-it-over version. */
export function ScorecardExport({ scores, brand, rangeLabel }: {
  scores: VehicleScore[]
  brand?: { companyName: string; logoUrl: string | null }
  rangeLabel?: string
}) {
  const [busy, setBusy] = useState(false)

  const downloadPdf = async () => {
    setBusy(true)
    try {
      const { createBrandedPdf, MARGIN } = await import('@/lib/pdf-brand')
      const autoTable = (await import('jspdf-autotable')).default
      const pdf = await createBrandedPdf({
        companyName: brand?.companyName ?? 'HammerTrack',
        logoUrl: brand?.logoUrl ?? null,
        title: 'Fleet report',
        subtitle: rangeLabel,
      })
      const { doc, pw, contentTop } = pdf

      // Fleet pulse line
      const miles = scores.reduce((s, v) => s + v.miles, 0)
      const act = Math.round(scores.reduce((s, v) => s + v.activeHrs, 0) * 10) / 10
      const idle = Math.round(scores.reduce((s, v) => s + v.idleHrs, 0) * 10) / 10
      const after = scores.reduce((s, v) => s + v.afterHoursMiles, 0)
      doc.setFontSize(10)
      doc.setTextColor(50, 65, 80)
      doc.text(`${miles.toLocaleString()} miles · ${act} working hours · ${idle} idle hours · ${after} after-hours miles`, MARGIN, contentTop + 2)

      const workMin = (s: VehicleScore, k: string) => s.stops.find((m) => m.kind === k)?.workMinutes ?? 0
      autoTable(doc, {
        startY: contentTop + 6,
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 8, cellPadding: 1.6, textColor: [55, 70, 85] },
        headStyles: { fillColor: [0, 41, 70], textColor: [255, 255, 255], fontSize: 8 },
        alternateRowStyles: { fillColor: [244, 247, 250] },
        head: [['Asset', 'Days moved', 'First move', 'On site', 'Last move', 'Working h', 'Idle %', 'Miles', 'After-hrs mi', 'Weekend mi', 'Food (work)', 'Stores (work)']],
        body: scores.map((s) => [
          s.name, s.daysActive, fmtClock(s.medFirstMove), fmtClock(s.medFirstOnSite), fmtClock(s.medLastMove),
          s.activeHrs, `${s.idlePct}%`, s.miles.toLocaleString(), s.afterHoursMiles, s.weekendMiles,
          `${Math.round(workMin(s, 'food'))}m`, `${Math.round(workMin(s, 'store'))}m`,
        ]),
      })

      // Method note
      const endY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? contentTop + 60
      doc.setFontSize(7.5)
      doc.setTextColor(130, 145, 160)
      doc.text('First/on-site/last are medians of active days. Stops count at 5+ minutes; food/store figures are time inside work hours.', MARGIN, Math.min(endY + 6, 200))
      void pw
      pdf.finish(`hammertrack-fleet-report-${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally { setBusy(false) }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={downloadPdf}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-muted text-sm font-medium px-3 py-2 hover:bg-navy-800 hover:text-ink transition-colors disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF
      </button>
      <ScorecardCsv scores={scores} />
    </span>
  )
}

function ScorecardCsv({ scores }: { scores: VehicleScore[] }) {
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
