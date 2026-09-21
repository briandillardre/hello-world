'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import {
  assessCtx, describeAll, mergeReadings, notReported, pickGauges, readingsFromRaw, truckHealth,
  type DeviceFamily, type Readings,
} from '@/lib/telemetry-catalog'
import type { TrendRow } from '@/lib/db/telemetry'
import { TruckGauges } from './TruckGauges'
import { ReadingsList } from './ReadingsList'
import { TrendStrip } from './TrendStrip'
import { TONE_HEX } from './Gauge'
import { shortDuration } from '@/lib/live-status'

/**
 * What the truck is telling us, for people who drive trucks: dials for the
 * readings a dashboard would show, a plain-words line for anything wrong,
 * then every other reading in words — and what this truck could report but
 * does not. The map panel gets the compact form and refreshes itself; the
 * asset page gets the full form with the week's trend.
 *
 * Data: the newest fix's raw bag paints instantly; /api/telemetry/<id> then
 * brings the stored map (every key the tracker has ever sent, with when).
 */
export function TruckData({ assetId, family, raw, rawTimestamp, initialReadings, trend, tz = 'America/New_York', compact = false }: {
  assetId: string
  family: DeviceFamily
  raw?: unknown
  rawTimestamp?: string | null
  initialReadings?: Readings | null
  trend?: TrendRow[]
  tz?: string
  compact?: boolean
}) {
  const live = useMemo(() => readingsFromRaw(raw, rawTimestamp), [raw, rawTimestamp])
  const [stored, setStored] = useState<Readings>(initialReadings ?? {})
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  // A new asset in the same mounted panel (tapping a truck in the
  // "Traveling together" card, or another dot while the sheet is up) must
  // not wear the previous truck's stored map while its own is fetched — the
  // F350's check-engine line was reading as Truck 4's for a second or two,
  // and for good if that fetch failed (ship-check, Sep 21).
  const shownFor = useRef(assetId)
  useEffect(() => {
    if (shownFor.current === assetId) return
    shownFor.current = assetId
    setStored(initialReadings ?? {})
    setUpdatedAt(null)
  }, [assetId, initialReadings])

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`/api/telemetry/${assetId}`, { credentials: 'include' })
        if (!r.ok) return
        const j = (await r.json()) as { readings?: Readings; updatedAt?: string | null }
        if (!alive) return
        if (j.readings) setStored(j.readings)
        setUpdatedAt(j.updatedAt ?? null)
      } catch { /* the newest fix still paints */ }
    }
    void load()
    const t = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [assetId])

  const readings = useMemo(() => mergeReadings(stored, live), [stored, live])
  const ctx = useMemo(() => assessCtx(readings, family), [readings, family])
  const gauges = useMemo(() => pickGauges(readings, ctx, compact ? 6 : 8), [readings, ctx, compact])
  const health = useMemo(() => truckHealth(readings, ctx), [readings, ctx])
  const described = useMemo(() => describeAll(readings, ctx), [readings, ctx])
  const missing = useMemo(() => notReported(readings, family), [readings, family])
  const newestMs = useMemo(() => {
    let m: number | null = null
    for (const r of Object.values(readings)) { const t = Date.parse(r.t); if (Number.isFinite(t) && (m == null || t > m)) m = t }
    return m
  }, [readings])

  const isTruck = family === 'obd' || family === 'wired'
  const count = described.filter((d) => !d.internal).length
  if (count === 0 && compact) return null
  if (count === 0 && !isTruck) return null

  const title = isTruck ? 'Truck readings' : 'Tracker readings'
  const stateWords = ctx.engineOn === true ? 'engine running' : ctx.engineOn === false ? 'engine off' : null

  return (
    <div className={compact ? 'rounded-xl border border-navy-700 bg-gradient-to-b from-navy-800 to-navy-900 p-3 space-y-2.5' : 'space-y-3'}>
      <div className="flex items-center gap-1.5">
        {ctx.engineOn && <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-blink" />}
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-teal">
          {title}{stateWords ? ` · ${stateWords}` : ''}
        </p>
        {newestMs != null && (
          <span className="ml-auto font-mono text-[9.5px] text-faint">{shortDuration(Date.now() - newestMs)} ago</span>
        )}
      </div>

      {health.length > 0 && (
        <ul className="space-y-0.5">
          {health.map((h) => (
            <li key={h.key} className="flex items-start gap-1.5 text-[12px] leading-snug">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: TONE_HEX[h.tone] }} />
              <span className="font-semibold" style={{ color: TONE_HEX[h.tone] }}>{h.text}</span>
            </li>
          ))}
        </ul>
      )}

      {gauges.length > 0
        ? <TruckGauges gauges={gauges} newestMs={newestMs} compact={compact} />
        : isTruck && (
          <p className="text-[11.5px] text-faint leading-snug">
            No engine readings from this truck yet — the unit is reporting position and power, but the truck&apos;s computer has not answered for RPM, fuel or temperatures over its port.
          </p>
        )}

      {compact ? (
        <details className="group">
          <summary className="flex min-h-[40px] cursor-pointer list-none items-center py-2 font-mono text-[10px] uppercase tracking-wide text-faint hover:text-muted">
            <span className="group-open:hidden">All readings ({count}) ▸</span>
            <span className="hidden group-open:inline">All readings ({count}) ▾</span>
          </summary>
          <div className="mt-2">
            <ReadingsList described={described} missing={missing} family={family} />
          </div>
        </details>
      ) : (
        <>
          {trend && trend.length > 0 && (
            <div>
              <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint mb-1.5">This week</p>
              <TrendStrip rows={trend} tz={tz} />
            </div>
          )}
          <ReadingsList described={described} missing={missing} family={family} full />
          {updatedAt && <p className="font-mono text-[9.5px] text-faint">Stored readings updated {shortDuration(Date.now() - Date.parse(updatedAt))} ago.</p>}
        </>
      )}
    </div>
  )
}
