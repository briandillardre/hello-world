'use client'

import { Repeat } from 'lucide-react'
import type { PatternWork } from '@/lib/pattern'
import { patternSummary } from '@/lib/pattern'

/**
 * Pattern work on one flight (Brian, Sep 12: "show how many touch and gos
 * were done … would be a nice feature to show traffic pattern consistency").
 *
 * The count answers the first half. The second half is answered by drawing
 * the laps ON TOP OF EACH OTHER: consistency is a shape question, and three
 * circuits that stack into one line say it faster than any statistic. The
 * numbers underneath are there to be quoted, not to be read first.
 *
 * Form notes (dataviz): the laps are an ORDERED series of the same thing, so
 * they take a sequential ramp (one hue, light → dark by lap order), never
 * categorical hues — those would imply the laps are different in kind. The
 * legend names each lap, so order never rides colour alone.
 */

/** Teal, light → dark. Lap 1 is palest; the last lap is the strongest. */
const LAP_RAMP = ['#7fe8dc', '#4fd6c6', '#2dbfae', '#1a9e91', '#0d7f76', '#075f59']
const FIELD = '#ffd94f'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export function PatternCard({ work }: { work: PatternWork }) {
  const { field, circuits, approaches, consistency } = work
  const lapColor = (i: number) => LAP_RAMP[Math.min(i, LAP_RAMP.length - 1)]

  // One frame centred on the field, sized to the widest lap, so every circuit
  // is drawn at the same scale and they can be compared by eye.
  const S = 260
  const pad = 18
  const widest = Math.max(0.4, ...circuits.map((c) => c.widthNm))
  const kx = Math.cos((field.lat * Math.PI) / 180)
  const nmPerDegLat = 60
  const px = (lat: number, lon: number) => {
    const dxNm = (lon - field.lon) * nmPerDegLat * kx
    const dyNm = (lat - field.lat) * nmPerDegLat
    const scale = (S / 2 - pad) / widest
    return [S / 2 + dxNm * scale, S / 2 - dyNm * scale] as const
  }

  return (
    <section className="rounded-xl border border-navy-800 bg-navy-900 p-3">
      <div className="mb-1 flex items-start gap-2">
        <Repeat className="mt-0.5 h-4 w-4 flex-none text-teal" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-bold text-ink">{patternSummary(work)}</h3>
          <p className="text-[11px] text-faint">
            {field.ident} · field elevation {field.elevationFt.toLocaleString()} ft
          </p>
        </div>
      </div>

      {consistency && (
        <p className="mb-2 text-[12px] leading-relaxed text-muted">
          Pattern altitude held within{' '}
          <b className="text-ink">{consistency.patternAglSpread} ft</b> of{' '}
          <b className="text-ink">{consistency.patternAglMean.toLocaleString()} ft AGL</b>
          , laps <b className="text-ink">{mmss(consistency.durationMeanSec)}</b>
          {consistency.durationSpreadSec >= 1 ? ` ± ${Math.round(consistency.durationSpreadSec)}s` : ' every time'}
          , downwind <b className="text-ink">{consistency.widthMeanNm.toFixed(1)} nm</b>
          {consistency.widthSpreadNm >= 0.05 ? ` ± ${consistency.widthSpreadNm.toFixed(1)}` : ''}.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {circuits.length > 0 && (
          <figure className="m-0 flex-none">
            <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} className="max-w-full rounded-lg bg-navy-950"
              role="img" aria-label={`The ${circuits.length} circuits drawn on top of each other`}>
              {/* Range rings, so "two miles out" is readable off the picture */}
              {[0.5, 1].map((r) => (
                <circle key={r} cx={S / 2} cy={S / 2} r={(S / 2 - pad) * r}
                  fill="none" stroke="rgba(159,182,204,0.12)" strokeWidth={1} />
              ))}
              {circuits.map((c, i) => (
                <path
                  key={c.startedAt}
                  d={c.path.map((p, k) => {
                    const [x, y] = px(p.lat, p.lon)
                    return `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
                  }).join(' ')}
                  fill="none"
                  stroke={lapColor(i)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  opacity={0.95}
                />
              ))}
              {/* The field itself */}
              <circle cx={S / 2} cy={S / 2} r={4} fill={FIELD} stroke="#00203a" strokeWidth={2} />
            </svg>
            <figcaption className="mt-1 text-center text-[10px] text-faint">
              every lap, same scale · rings at {(widest / 2).toFixed(1)} and {widest.toFixed(1)} nm
            </figcaption>
          </figure>
        )}

        {/* The table doubles as the legend, so a lap is never identified by
            colour alone. */}
        <div className="min-w-[200px] flex-1">
          <table className="w-full text-left text-[11.5px]">
            <thead className="text-faint">
              <tr>
                <th scope="col" className="py-1 font-semibold">Lap</th>
                <th scope="col" className="py-1 font-semibold">Time</th>
                <th scope="col" className="py-1 font-semibold">Pattern</th>
                <th scope="col" className="py-1 font-semibold">Downwind</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              {circuits.map((c, i) => (
                <tr key={c.startedAt} className="border-t border-navy-800/60">
                  <td className="py-1">
                    <span className="inline-flex items-center gap-1.5">
                      <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: lapColor(i) }} />
                      {i + 1}
                    </span>
                  </td>
                  <td className="py-1">{mmss(c.durationSec)}</td>
                  <td className="py-1">{c.patternAgl.toLocaleString()} ft</td>
                  <td className="py-1">{c.widthNm.toFixed(1)} nm</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">
            Lowest point of each approach:{' '}
            {approaches.map((a) => `${a.lowestAgl} ft`).join(' · ')} AGL. Receivers usually lose an
            aircraft at runway height, so the touchdown itself is in the gap — these are the last
            fix before it.
          </p>
        </div>
      </div>
    </section>
  )
}
