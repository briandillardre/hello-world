'use client'

import { useEffect, useState } from 'react'

/**
 * Site-wide activity indicator: a thin amber sweep pinned to the very top of
 * the screen + a pill naming what's happening ("Copying placement — sheet 2
 * of 5…"). Driven by lib/busy.ts from any component — the page never again
 * looks frozen while work runs (owner ask, Aug 7).
 */
export function BusyBar() {
  const [jobs, setJobs] = useState<{ id: string; label: string }[]>([])

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; label: string }>).detail
      if (d?.id) setJobs((j) => [...j.filter((x) => x.id !== d.id), d])
    }
    const off = (e: Event) => {
      const d = (e as CustomEvent<{ id: string }>).detail
      if (d?.id) setJobs((j) => j.filter((x) => x.id !== d.id))
    }
    window.addEventListener('ht:busy', on)
    window.addEventListener('ht:idle', off)
    return () => {
      window.removeEventListener('ht:busy', on)
      window.removeEventListener('ht:idle', off)
    }
  }, [])

  if (jobs.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[120]">
      <div className="h-[3px] overflow-hidden bg-navy-800/80">
        <div className="h-full w-1/3 animate-tl-sweep bg-gradient-to-r from-transparent via-amber to-amber" />
      </div>
      <div className="mx-auto mt-1.5 w-fit max-w-[90vw] truncate rounded-full border border-amber/40 bg-navy-950/95 px-3 py-1 text-[11px] font-semibold text-amber shadow-panel">
        {jobs[jobs.length - 1].label}
      </div>
    </div>
  )
}
