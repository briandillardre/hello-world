'use client'

import { useState } from 'react'
import { MonitorPlay } from 'lucide-react'

/**
 * Founder tool: turn THIS account's company into the showroom — seeds the
 * simulated fleet + zones, and the simulator cron takes it from there.
 * Lives on /model (owner-gated) so it never shows for customers.
 */
export function ShowroomCard() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const seed = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/admin/seed-showroom', { method: 'POST' })
      const j = (await r.json()) as { ok?: boolean; error?: string; zonesAdded?: number; assetsAdded?: number; rulesAdded?: number; note?: string }
      setMsg(j.ok
        ? `Seeded: ${j.zonesAdded} zones, ${j.assetsAdded} assets, ${j.rulesAdded} alert rules. ${j.note ?? ''}`
        : (j.error ?? 'Failed.'))
    } catch {
      setMsg('Network error — try again.')
    }
    setBusy(false)
  }

  return (
    <div className="rounded-xl border border-navy-800 bg-navy-950 p-4 space-y-2">
      <p className="font-display font-bold text-[14px] text-ink flex items-center gap-2">
        <MonitorPlay className="h-4 w-4 text-teal" /> Showroom company
      </p>
      <p className="text-[12.5px] text-muted leading-snug">
        Seeds THIS account&rsquo;s company with the simulated fleet (3 trucks, 3 machines,
        2 people, 2 tool tags) and 4 Greenville-area zones, then the simulator drives it
        24/7 through the real ingest pipeline. Move or redraw zones and the trucks route
        to the new spots on real roads within a few minutes. Refuses to touch a company
        that has real hardware — run it from a fresh account.
      </p>
      <button
        onClick={seed}
        disabled={busy}
        className="rounded-lg bg-teal/20 text-teal border border-teal/40 font-display font-bold text-[12.5px] px-3 py-1.5 hover:bg-teal/30 transition-colors disabled:opacity-50"
      >
        {busy ? 'Seeding…' : 'Seed showroom into this company'}
      </button>
      {msg && <p className="text-[12px] text-amber leading-snug">{msg}</p>}
    </div>
  )
}
