import { CloudRain } from 'lucide-react'

export interface SiteWeatherRow {
  day: string
  temp_hi: number | null
  temp_lo: number | null
  rain_in: number | null
  wind_max: number | null
  /** Model grid point that supplied the numbers (migration 060). */
  src_lat?: number | null
  src_lng?: number | null
  src_elev_m?: number | null
}

const R_MI = 3958.8
function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R_MI * Math.asin(Math.sqrt(s))
}
function bearingLabel(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
  const toRad = (d: number) => (d * Math.PI) / 180
  const y = Math.sin(toRad(toLng - fromLng)) * Math.cos(toRad(toLat))
  const x = Math.cos(toRad(fromLat)) * Math.sin(toRad(toLat)) -
    Math.sin(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.cos(toRad(toLng - fromLng))
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]
}
const fmtCoord = (lat: number, lng: number) => `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`

/**
 * The rain-delay receipt: this site's daily conditions, straight off the
 * nightly weather log. When a GC asks why the pour slipped, this table is
 * the answer with dates on it.
 */
export function ZoneWeather({ rows, centroid = null }: {
  rows: SiteWeatherRow[]
  /** Zone center the nightly cron samples at (ring-vertex average). */
  centroid?: { lat: number; lng: number } | null
}) {
  if (!rows.length) return null

  // Provenance line — where these numbers actually came from ("we need
  // details on where this information came from", Aug 10). Newest row with
  // a stored grid point wins; older rows predate migration 060.
  const src = rows.find((r) => typeof r.src_lat === 'number' && typeof r.src_lng === 'number')
  let provenance: string
  if (src && centroid) {
    const mi = milesBetween(centroid.lat, centroid.lng, src.src_lat!, src.src_lng!)
    const dir = bearingLabel(centroid.lat, centroid.lng, src.src_lat!, src.src_lng!)
    const elev = typeof src.src_elev_m === 'number' ? ` at ${Math.round(src.src_elev_m * 3.28084)} ft elevation` : ''
    provenance =
      `Source: Open-Meteo blended forecast models (NOAA & partner agencies) · nearest model grid point ` +
      `${fmtCoord(src.src_lat!, src.src_lng!)}${elev} — ${mi < 0.05 ? 'right on' : `${mi.toFixed(1)} mi ${dir} of`} ` +
      `this site's center (${fmtCoord(centroid.lat, centroid.lng)}) · logged nightly.`
  } else if (centroid) {
    provenance =
      `Source: Open-Meteo blended forecast models, sampled at this site's center ` +
      `(${fmtCoord(centroid.lat, centroid.lng)}; model grid ≈1–7 mi). Exact grid-point detail is logged ` +
      `from tonight's run onward (run migration 060).`
  } else {
    provenance = 'Source: Open-Meteo blended forecast models, sampled at this site’s location · logged nightly.'
  }
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
        <p className="px-3 py-2 border-t border-navy-800 text-[10px] text-faint leading-relaxed">
          {provenance} Documentation for rain-delay claims.
        </p>
      </div>
    </section>
  )
}
