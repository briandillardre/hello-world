'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'

/** Open an empty plan room on a site that has none yet (its Add a set button is there). */
export function StartPlanRoom({ sites }: { sites: { id: string; name: string }[] }) {
  const router = useRouter()
  const [id, setId] = useState('')
  return (
    <div className="rounded-xl border border-navy-800 bg-navy-900 p-3 flex items-center gap-2 flex-wrap">
      <p className="text-[12.5px] text-muted w-full sm:w-auto sm:flex-1">Start a plan room on another site</p>
      <select value={id} onChange={(e) => setId(e.target.value)} aria-label="Site"
        className="rounded-lg bg-navy-950 border border-navy-700 px-2 py-2 text-sm text-ink max-w-[16rem]">
        <option value="">Pick a site…</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button type="button" disabled={!id} onClick={() => router.push(`/plans/${id}`)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-bold text-xs px-3 py-2 disabled:opacity-40">
        <Plus className="h-3.5 w-3.5" /> Open
      </button>
    </div>
  )
}
