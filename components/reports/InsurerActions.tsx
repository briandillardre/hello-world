'use client'

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { isNativeApp } from '@/lib/native'
import { PrintButton } from './PrintButton'

const CSV = [
  { kind: 'vehicles', label: 'Vehicles CSV' },
  { kind: 'months', label: 'Months CSV' },
  { kind: 'events', label: 'Events CSV' },
] as const

/**
 * The insurer report's doors out: the three CSVs and Print / Save as PDF.
 * Inside the Android / iOS app neither works — the WebView has no download
 * handler and window.print() does nothing there — so the app says where they
 * do instead of offering buttons that silently fail (as Fuel check and Time
 * cards do). Decided after mount: the shell is only knowable in the browser.
 */
export function InsurerActions() {
  const [native, setNative] = useState<boolean | null>(null)
  useEffect(() => { setNative(isNativeApp()) }, [])
  if (native === null) return null
  if (native) {
    return <p className="ml-auto max-w-[220px] text-right text-[11.5px] text-faint">Open this page on a computer to print or download it.</p>
  }
  return (
    <div className="ml-auto flex items-center gap-2 flex-wrap">
      {CSV.map((c) => (
        <a key={c.kind} href={`/api/safety/export?kind=${c.kind}`} className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink hover:bg-navy-800">
          <Download className="h-4 w-4" /> {c.label}
        </a>
      ))}
      <PrintButton />
    </div>
  )
}
