import { Route, MoveRight } from 'lucide-react'
import type { Trip } from '@/lib/trips'
import { ExportCsv } from '@/components/ui/ExportCsv'
import { fmtTime, fmtDay, fmtDateTime, dayKey } from '@/lib/dates'

/**
 * The drive history a contractor actually reads: when it left, where it went,
 * how long, how far, how fast. Zone names ground each end of the trip in
 * places the company knows ("Yard → Riverfront Tower"), not coordinates.
 * All times in the viewer's tz — this renders on a UTC server.
 */
export function TripLog({ trips, days, tz }: { trips: Trip[]; days: number; tz: string }) {
  const totalMiles = Math.round(trips.reduce((s, t) => s + t.miles, 0) * 10) / 10
  const totalMin = trips.reduce((s, t) => s + t.minutes, 0)

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">
          Trips · last {days} days
        </h2>
        {trips.length > 0 && (
          <span className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-faint tabular-nums">
              {trips.length} trips · {totalMiles.toLocaleString()} mi · {Math.floor(totalMin / 60)}h {totalMin % 60}m
            </span>
            <ExportCsv
              filename="trips.csv"
              headers={['Start', 'End', 'From zone', 'To zone', 'Minutes', 'Miles', 'Max mph']}
              rows={trips.map((t) => [
                fmtDateTime(t.startMs, tz),
                fmtDateTime(t.endMs, tz),
                t.startZone ?? '', t.endZone ?? '', t.minutes, t.miles, t.maxMph,
              ])}
            />
          </span>
        )}
      </div>

      {trips.length === 0 ? (
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          No drives recorded in this window — trips appear after the tracker sees real movement.
        </p>
      ) : (
        <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800/70">
          {trips.map((t, i) => {
            const sameDayAsPrev = i > 0 && dayKey(trips[i - 1].startMs, tz) === dayKey(t.startMs, tz)
            return (
              <div key={t.startMs}>
                {!sameDayAsPrev && (
                  <p className="px-4 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-teal">
                    {fmtDay(t.startMs, tz)}
                  </p>
                )}
                <div className="px-4 py-2.5 flex items-center gap-3">
                  <Route className="h-4 w-4 text-faint flex-none" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono tabular-nums">{fmtTime(t.startMs, tz)}</span>
                      <span className="text-faint truncate max-w-[95px]">{t.startZone ?? 'off-zone'}</span>
                      <MoveRight className="h-3.5 w-3.5 text-faint flex-none" />
                      <span className="text-faint truncate max-w-[95px]">{t.endZone ?? 'off-zone'}</span>
                      <span className="font-mono tabular-nums text-faint">{fmtTime(t.endMs, tz)}</span>
                    </p>
                    <p className="font-mono text-[11px] text-faint tabular-nums mt-0.5">
                      {t.minutes} min · {t.miles} mi · max {t.maxMph} mph
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
