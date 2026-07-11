import type { Visit } from '@/lib/visits'
import type { AssetType } from '@/lib/types'
import { ExportCsv } from '@/components/ui/ExportCsv'

const TYPE_EMOJI: Record<AssetType, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }

const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
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
function rollUpByDay(visits: Visit[]): DayGroup[] {
  const days = new Map<string, Map<string, DayLine>>()
  for (const v of visits) {
    const d = new Date(v.enterMs)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
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
      label: new Date(lines[0].firstIn).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }),
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
  visits, assetMeta, days, zoneName,
}: {
  visits: Visit[]
  assetMeta: Record<string, { name: string; type: AssetType }>
  days: number
  zoneName: string
}) {
  const groups = rollUpByDay(visits)

  const csvRows = groups.flatMap((g) =>
    g.lines.map((l) => [
      new Date(l.firstIn).toLocaleDateString(),
      assetMeta[l.assetId]?.name ?? l.assetId,
      assetMeta[l.assetId]?.type ?? '',
      t(l.firstIn),
      l.lastOut === null ? 'still on site' : t(l.lastOut),
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
          {groups.slice(0, 14).map((g) => (
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
                          in {t(l.firstIn)} · {l.lastOut === null
                            ? <span className="text-[#34d399]">on site now</span>
                            : <>out {t(l.lastOut)}</>}
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
        </div>
      )}
    </section>
  )
}
