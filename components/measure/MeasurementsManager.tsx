'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MapPin, Spline, Hexagon, Map as MapIcon, Trash2, Ruler, Lock } from 'lucide-react'
import type { Measurement } from '@/lib/db/measurements'
import { measureSummary } from '@/lib/measure'
import { deleteMeasurementAction } from '@/lib/actions/measurements'

const KIND_META = {
  point: { icon: MapPin, label: 'Point' },
  line: { icon: Spline, label: 'Length' },
  area: { icon: Hexagon, label: 'Area' },
} as const

/** The saved-measurements list. Every row jumps back onto the map exactly
 *  where it was drawn (/map?m=<id>); delete is two-tap (arm, then confirm). */
export function MeasurementsManager({ measurements }: { measurements: Measurement[] }) {
  const router = useRouter()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const remove = (id: string) => {
    if (confirmId !== id) { setConfirmId(id); return }
    setConfirmId(null)
    startTransition(async () => {
      const r = await deleteMeasurementAction(id)
      if (!r.ok) setErr(r.error ?? 'Delete failed.')
      else router.refresh()
    })
  }

  if (measurements.length === 0) {
    return (
      <div className="grid place-items-center px-6 py-20 text-center">
        <div className="max-w-sm space-y-3">
          <Ruler className="h-8 w-8 text-faint mx-auto" />
          <p className="font-display font-bold text-[15px] text-ink">Nothing measured yet</p>
          <p className="text-[13px] text-faint leading-relaxed">
            Open the map, tap the ruler button in the map controls, and measure a
            distance, an area, or drop a point. Hit <span className="text-amber font-semibold">Save measurement</span> and
            it lands here — with the takeoff tonnage if you set a depth.
          </p>
          <Link href="/map" className="inline-block font-display font-bold text-[13px] rounded-xl px-5 py-2.5 bg-amber text-[#1a1100] hover:bg-amber-600 transition-colors">
            Open the map
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 md:p-4 space-y-2 max-w-3xl">
      {err && <p className="text-[12px] text-alert px-1">{err}</p>}
      {measurements.map((m) => {
        const meta = KIND_META[m.kind]
        const Icon = meta.icon
        const arming = confirmId === m.id
        return (
          <div key={m.id} className="flex items-center gap-3 rounded-xl bg-navy-900 border border-navy-800 px-3.5 py-3">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-amber/10 border border-amber/25 flex-none">
              <Icon className="h-4 w-4 text-amber" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-ink truncate flex items-center gap-1.5">
                {m.name}
                {m.personal && (
                  <span title="Only you can see this" className="inline-flex items-center gap-0.5 font-mono text-[9px] uppercase tracking-wide text-[#c4b5fd]">
                    <Lock className="h-3 w-3" /> me
                  </span>
                )}
              </p>
              <p className="font-mono text-[11px] text-muted truncate tabular-nums">{measureSummary(m.kind, m.props)}</p>
              <p className="font-mono text-[10px] text-faint mt-0.5">
                {meta.label} · {new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </p>
            </div>
            <Link
              href={`/map?m=${m.id}`}
              className="flex-none flex items-center gap-1 rounded-lg border border-teal/40 text-teal text-[11.5px] font-semibold px-2.5 py-1.5 hover:bg-teal/10 transition-colors"
            >
              <MapIcon className="h-3.5 w-3.5" /> Map
            </Link>
            <button
              onClick={() => remove(m.id)}
              disabled={pending}
              className={'flex-none flex items-center gap-1 rounded-lg border text-[11.5px] font-semibold px-2.5 py-1.5 transition-colors disabled:opacity-40 ' +
                (arming ? 'border-alert/60 text-alert bg-alert/10' : 'border-navy-700 text-faint hover:text-alert')}
            >
              <Trash2 className="h-3.5 w-3.5" /> {arming ? 'Sure?' : 'Delete'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
