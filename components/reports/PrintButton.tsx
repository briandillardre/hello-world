'use client'

import { Printer } from 'lucide-react'

/** Opens the browser's print dialog — "Save as PDF" is how an insurer report
 *  becomes a file to attach. */
export function PrintButton({ label = 'Print or save as PDF' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm px-3.5 py-2 hover:bg-amber-600 transition-colors">
      <Printer className="h-4 w-4" /> {label}
    </button>
  )
}
