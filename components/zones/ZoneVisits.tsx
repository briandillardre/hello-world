'use client'

import { useState } from 'react'
import type { Visit } from '@/lib/visits'
import type { AssetType } from '@/lib/types'
import { ExportCsv } from '@/components/ui/ExportCsv'
import { fmtTime, fmtDayLong, fmtDateTime, dayKey } from '@/lib/dates'

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }

const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`)

interface DayLine {
  assetId: string
  firstIn: number
  lastOut: number | null // null = on site now
  totalMin: number
  trips: number
}

interface DayGroup {
  key: string
  label: string
  lines: DayLine[]
  totalMin: number
  onSiteNow: number
}

/** Roll raw visits up into a daily crew log: one line per asset per day —
 *  first arrival, last departure, total time on site. The timesheet view. */
function rollUpByDay(visits: Visit[], tz: string): DayGroup[] {
  const days = new Map<string, Map<string, DayLine>>()
  for (const v of visits) {
    // Bucket by the crew's LOCAL day — the server renders in UTC, where a
    // 9 PM arrival would otherwise land on tomorrow's card.
    const key = dayKey(v.enterMs, tz)
    let assets = days.get(key)
    if (!assets) days.set(key, (assets = new Map()))
    const line = assets.get(v.assetId)
    if (!line) {
      assets.set(v.assetId, {
        assetId: v.assetId,
        firstIn: v.enterMs,
        lastOut: v.exitMs,
        totalMin: v.minutes,
        trips: 1,
      })
    } else {
      line.firstIn = Math.min(line.firstIn, v.enterMs)
      // any open visit today means the asset is on site now
      line.lastOut = line.lastOut === null || v.exitMs === null ? null : Math.max(line.lastOut, v.exitMs)
      line.totalMin += v.minutes
      line.trips += 1
    }
  }

  const groups: DayGroup[] = []
  for (const [key, assets] of Array.from(days.entries())) {
    const lines = Array.from(assets.values()).sort(
      (a: DayLine, b: DayLine) => a.firstIn - b.firstIn
    )
    groups.push({
      key,
      label: fmtDayLong(lines[0].firstIn, tz),
      lines,
      totalMin: lines.reduce((s, l) => s + l.totalMin, 0),
      onSiteNow: lines.filter((l) => l.lastOut === null).length,
    })
  }
  return groups.sort((a, b) => b.lines[0].firstIn - a.lines[0].firstIn)
}

/** The site log: who showed up, when, and for how long — one line per asset
 *  per day, with a crew-day total. The pre-timesheet a GC actually wants. */
export function ZoneVisits({
  visits, assetMeta, days, zoneName, tz,
}: {
  visits: Visit[]
  assetMeta: Record<string, { name: string; type: AssetType }>
  days: number
  zoneName: string
  tz: string
}) {
  const groups = rollUpByDay(visits, tz)

  // A busy zone's 30-day log runs to hundreds of rows — start with the
  // newest ~10 asset lines (whole days only) and grow on demand ("see
  // more", Brian, Aug 9). CSV export always carries the full window.
  const [rowLimit, setRowLimit] = useState(10)
  const shown: DayGroup[] = []
  let rowCount = 0
  for (const g of groups) {
    if (shown.length > 0 && rowCount >= rowLimit) break
    shown.push(g)
    rowCount += g.lines.length
  }
  const hiddenDays = groups.length - shown.length
  const hiddenRows = groups.slice(shown.length).reduce((s, g) => s + g.lines.length, 0)

  const csvRows = groups.flatMap((g) =>
    g.lines.map((l) => [
      fmtDateTime(l.firstIn, tz).split(',')[0],
      assetMeta[l.assetId]?.name ?? l.assetId,
      assetMeta[l.assetId]?.type ?? '',
      fmtTime(l.firstIn, tz),
      l.lastOut === null ? 'still on site' : fmtTime(l.lastOut, tz),
      (l.totalMin / 60).toFixed(2),
      String(l.trips),
    ])
  )

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
          Site log · last {days} days
        </h2>
        <ExportCsv
          filename={`${zoneName.replace(/[^\w-]+/g, '-')}-site-log.csv`}
          headers={['Date', 'Asset', 'Type', 'First arrival', 'Last departure', 'Hours on site', 'Trips']}
          rows={csvRows}
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No arrivals recorded yet — the log fills in when a tracked asset enters this zone.
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((g) => (
            <div key={g.key} className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
              <div className="px-4 py-2.5 flex items-baseline gap-2 border-b border-navy-800/70 bg-navy-950/40">
                <p className="font-display font-bold text-sm text-ink">{g.label}</p>
                <p className="ml-auto font-mono text-[11px] text-faint tabular-nums">
                  {g.lines.length} asset{g.lines.length === 1 ? '' : 's'} · {dur(g.totalMin)} on site
                  {g.onSiteNow > 0 && <span className="text-[#34d399]"> · {g.onSiteNow} here now</span>}
                </p>
              </div>
              <div className="divide-y divide-navy-800/50">
                {g.lines.map((l) => {
                  const meta = assetMeta[l.assetId]
                  return (
                    <div key={l.assetId} className="px-4 py-2.5 flex items-center gap-3">
                      <span className="text-lg flex-none">{meta ? TYPE_EMOJI[meta.type] : '📍'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink truncate">{meta?.name ?? 'Unknown asset'}</p>
                        <p className="font-mono text-[11px] text-faint tabular-nums">
                          in {fmtTime(l.firstIn, tz)} · {l.lastOut === null
                            ? <span className="text-[#34d399]">on site now</span>
                            : <>out {fmtTime(l.lastOut, tz)}</>}
                          {l.trips > 1 && <span className="text-faint/70"> · {l.trips} trips</span>}
                        </p>
                      </div>
                      <p className="font-mono text-sm text-amber tabular-nums flex-none">{dur(l.totalMin)}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          {hiddenDays > 0 && (
            <button
              type="button"
              onClick={() => setRowLimit((l) => l + 30)}
              className="w-full rounded-xl border border-dashed border-navy-700 bg-navy-900/50 py-2.5 text-[12.5px] font-semibold text-muted hover:text-ink hover:border-amber/50 transition-colors"
            >
              See more · {hiddenDays} earlier day{hiddenDays === 1 ? '' : 's'} ({hiddenRows} visit{hiddenRows === 1 ? '' : 's'})
            </button>
          )}
        </div>
      )}
    </section>
  )
}
