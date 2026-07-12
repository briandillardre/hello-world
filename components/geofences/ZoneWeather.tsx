import { CloudRain } from 'lucide-react'

export interface SiteWeatherRow {
  day: string
  temp_hi: number | null
  temp_lo: number | null
  rain_in: number | null
  wind_max: number | null
}

/**
 * The rain-delay receipt: this site's daily conditions, straight off the
 * nightly weather log. When a GC asks why the pour slipped, this table is
 * the answer with dates on it.
 */
export function ZoneWeather({ rows }: { rows: SiteWeatherRow[] }) {
  if (!rows.length) return null
  return (
    <section>
      <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint mb-2 flex items-center gap-1.5">
        <CloudRain className="h-3.5 w-3.5 text-teal" /> Weather log · last {rows.length} day{rows.length === 1 ? '' : 's'}
      </h2>
      <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-wide text-faint border-b border-navy-800">
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2 text-right">Hi / Lo</th>
              <th className="px-3 py-2 text-right">Rain</th>
              <th className="px-3 py-2 text-right">Max wind</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const wet = (r.rain_in ?? 0) >= 0.1
              return (
                <tr key={r.day} className="border-b border-navy-800/60 last:border-b-0">
                  <td className="px-3 py-1.5 text-muted">
                    {new Date(`${r.day}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-3 py-1.5 text-right text-ink tabular-nums">
                    {r.temp_hi != null ? Math.round(r.temp_hi) : '—'}° / {r.temp_lo != null ? Math.round(r.temp_lo) : '—'}°
                  </td>
                  <td className={'px-3 py-1.5 text-right tabular-nums font-medium ' + (wet ? 'text-teal' : 'text-faint')}>
                    {r.rain_in != null ? `${r.rain_in.toFixed(2)}"` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted tabular-nums">
                    {r.wind_max != null ? `${Math.round(r.wind_max)} mph` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 border-t border-navy-800 text-[10px] text-faint">
          Logged nightly at this site&apos;s location — documentation for rain-delay claims.
        </p>
      </div>
    </section>
  )
}
