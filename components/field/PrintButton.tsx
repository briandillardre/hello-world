'use client'

import { Printer } from 'lucide-react'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-semibold text-[13px] px-3.5 py-2 hover:brightness-110 transition flex-none"
    >
      <Printer className="h-4 w-4" /> Print sheet
    </button>
  )
}
