'use client'

// Brain Ball — shared round back button (was duplicated per screen).

import { ArrowLeft } from 'lucide-react'

export function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      aria-label="Back"
      className="w-10 h-10 rounded-full bg-white border-2 border-slate-200 shadow flex items-center justify-center active:scale-95"
    >
      <ArrowLeft className="w-5 h-5 text-slate-500" />
    </button>
  )
}
