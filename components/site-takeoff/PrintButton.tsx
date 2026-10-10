'use client'

import { Printer } from 'lucide-react'

export default function PrintButton() {
  return (
    <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded border border-gray-400 px-3 py-1.5 text-sm print:hidden">
      <Printer className="h-4 w-4" /> Print
    </button>
  )
}
