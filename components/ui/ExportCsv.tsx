'use client'

import { Download } from 'lucide-react'

/** Tiny client-side CSV download — contractors and insurers live in Excel.
 *  Data arrives as serializable props from the server component. */
export function ExportCsv({ filename, headers, rows, label = 'CSV' }: {
  filename: string
  headers: string[]
  rows: (string | number)[][]
  label?: string
}) {
  const download = () => {
    const esc = (v: string | number) => {
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }) // BOM for Excel
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  if (rows.length === 0) return null
  return (
    <button
      onClick={download}
      className="inline-flex items-center gap-1 text-[11px] font-semibold text-faint hover:text-teal border border-navy-700 rounded-md px-2 py-1 transition-colors"
      title={`Download ${filename}`}
    >
      <Download className="h-3 w-3" /> {label}
    </button>
  )
}
