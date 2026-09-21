'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { GROUP_LABELS, GROUP_ORDER, type Described, type ReadingDef, type DeviceFamily } from '@/lib/telemetry-catalog'
import { TONE_HEX } from './Gauge'
import { shortDuration } from '@/lib/live-status'

/**
 * Every reading this tracker has sent, in words, grouped — then what it
 * COULD send but never has. The second list is the honest half: a foreman
 * looking for a fuel gauge on the F650 learns the truck's computer does not
 * answer for one, rather than assuming the app forgot.
 */
export function ReadingsList({ described, missing, family, full = false }: {
  described: Described[]
  missing: ReadingDef[]
  family: DeviceFamily
  /** Asset page: show counts and first-seen, and open the missing list. */
  full?: boolean
}) {
  const [plumbing, setPlumbing] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const visible = described.filter((d) => plumbing || !d.internal)
  const hidden = described.length - described.filter((d) => !d.internal).length

  const groups = GROUP_ORDER
    .map((g) => [g, visible.filter((d) => d.group === g)] as const)
    .filter(([, rows]) => rows.length > 0)

  return (
    <div className="space-y-3">
      {groups.map(([g, rows]) => (
        <div key={g}>
          <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint mb-1">{GROUP_LABELS[g]}</p>
          <ul className="divide-y divide-navy-800/70 rounded-lg bg-navy-950/60">
            {rows.map((d) => (
              <li key={d.key} className="flex items-baseline gap-2 px-2.5 py-1.5" title={d.def?.explain ?? d.key}>
                <span
                  aria-hidden
                  className="mt-1.5 h-1.5 w-1.5 flex-none self-start rounded-full"
                  style={{ backgroundColor: d.tone === 'info' ? 'transparent' : TONE_HEX[d.tone], boxShadow: d.tone === 'info' ? 'inset 0 0 0 1px #46586a' : undefined }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-muted leading-snug">{d.label}</span>
                  {d.words && (d.tone === 'bad' || d.tone === 'warn') && (
                    <span className="block text-[10.5px] font-semibold leading-snug" style={{ color: TONE_HEX[d.tone] }}>{d.words}</span>
                  )}
                  {full && d.def?.explain && <span className="block text-[10.5px] text-faint leading-snug">{d.def.explain}</span>}
                </span>
                <span className="text-right flex-none">
                  <span className="block text-[13px] font-semibold tabular-nums text-ink leading-snug">{d.text}</span>
                  <span className="block font-mono text-[9.5px] text-faint leading-snug">
                    {ago(d.t)}{full && d.n ? ` · ${d.n.toLocaleString()} reports` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {hidden > 0 && (
        <button type="button" onClick={() => setPlumbing((v) => !v)} className="flex min-h-[40px] items-center py-2 font-mono text-[10px] uppercase tracking-wide text-faint hover:text-muted">
          {plumbing ? 'Hide' : 'Show'} device plumbing ({hidden})
        </button>
      )}

      {missing.length > 0 && (
        <div className="rounded-lg border border-dashed border-navy-700 px-2.5 py-2">
          <button type="button" onClick={() => setShowMissing((v) => !v)} className="flex min-h-[40px] w-full items-center gap-1.5 py-1 text-left">
            <ChevronDown className={'h-3.5 w-3.5 flex-none text-faint transition-transform ' + (showMissing || full ? '' : '-rotate-90')} />
            <span className="text-[12px] font-semibold text-muted">Not reported by this {family === 'obd' || family === 'wired' ? 'truck' : 'tracker'} ({missing.length})</span>
          </button>
          {(showMissing || full) && (
            <>
              <p className="mt-1.5 text-[11px] text-faint leading-snug">
                {family === 'obd' || family === 'wired'
                  ? 'The unit can ask the truck’s computer for all of these; this truck has not answered for them over its OBD port. Older trucks answer for fewer; medium-duty trucks (F650, F750) speak a different language on the port and need the wired CAN unit for engine data.'
                  : 'What a tracker of this kind can send that this one has not sent yet.'}
              </p>
              <ul className="mt-1.5 grid gap-x-3 gap-y-1 sm:grid-cols-2">
                {missing.map((d) => (
                  <li key={d.key} className="text-[11.5px] leading-snug">
                    <span className="text-muted">{d.label}</span>
                    {d.unit ? <span className="text-faint"> · {d.unit}</span> : null}
                    <span className="block text-[10.5px] text-faint">{d.explain}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return ms < 90_000 ? 'just now' : `${shortDuration(ms)} ago`
}
