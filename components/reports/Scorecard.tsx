/**
 * Fleet scorecard visuals — server-rendered SVG/JSX, no client JS.
 *
 * Palette note (validated with the dataviz six-checks script on navy-900
 * #00203a): the stop-mix display order below keeps every ADJACENT pair
 * ΔE ≥ 15.6 under protan/deutan simulation and ≥ 17.8 for normal vision,
 * with ≥ 3:1 contrast against the surface. Kind colors are the app-wide
 * POI mapping (map pins, stop panels) — same entity, same hue everywhere.
 * The two neutrals (residence = light slate, other = gray) are semantic
 * non-categories; every bar ships direct labels + a legend with minutes and
 * 2px surface gaps, so identity is never carried by hue alone.
 */

import type { DayRhythm, StopMix, VehicleScore } from '@/lib/scorecard'
import { fmtClock } from '@/lib/scorecard'
import { POI_KIND_COLOR, POI_KIND_META, type PoiKind } from '@/lib/poi'
import { dayKey } from '@/lib/dates'

/** "6h 30m" / "45m" from minutes. */
export function fmtHM(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

// ── Day-rhythm strip ─────────────────────────────────────────────────────────
// One row per calendar day, newest on top: a bar from first move to last move
// on a midnight-to-midnight axis, the company work window shaded behind it.
// Late starts, short days, and after-hours runs read at a glance — position
// does the judging, no second hue needed.

const W = 760
const LG = 58   // left gutter: day label
const RG = 44   // right gutter: miles
const AXIS = 14

const xOf = (min: number) => LG + (min / 1440) * (W - LG - RG)

export function DayStrip({ days, windowFrom, windowTo, tz, workStart, workEnd, maxRows = 21 }: {
  days: DayRhythm[]
  windowFrom: number
  windowTo: number
  tz: string
  workStart: string
  workEnd: string
  maxRows?: number
}) {
  const byKey = new Map(days.map((d) => [d.day, d]))
  // Walk calendar days newest-first from the window's last instant.
  const rows: { key: string; label: string; d?: DayRhythm }[] = []
  const lastMs = Math.min(windowTo - 1, Date.now())
  const labelFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'numeric', day: 'numeric' })
  for (let ms = lastMs; ms >= windowFrom && rows.length < maxRows; ms -= 86_400_000) {
    const key = dayKey(ms, tz)
    if (rows.some((r) => r.key === key)) continue // DST double-day guard
    rows.push({ key, label: labelFmt.format(new Date(ms)).replace(',', ''), d: byKey.get(key) })
  }
  const spanned = Math.max(1, Math.round((windowTo - windowFrom) / 86_400_000))
  const clipped = spanned > rows.length

  const rowH = 13
  const H = AXIS + rows.length * rowH + 4
  const ws = toMin(workStart)
  const we = toMin(workEnd)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Daily first-move to last-move spans">
        {/* work-hours band */}
        <rect x={xOf(ws)} y={AXIS - 3} width={xOf(we) - xOf(ws)} height={H - AXIS + 1} fill="#ff9e16" opacity={0.07} />
        {[360, 720, 1080].map((m) => (
          <g key={m}>
            <line x1={xOf(m)} y1={AXIS - 3} x2={xOf(m)} y2={H - 2} stroke="#e8f0f7" opacity={0.06} />
            <text x={xOf(m)} y={AXIS - 6} textAnchor="middle" fontSize={8.5} fill="#6f88a0" fontFamily="var(--font-mono)">
              {m === 360 ? '6a' : m === 720 ? 'noon' : '6p'}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = AXIS + i * rowH
          const cy = y + rowH / 2
          const d = r.d
          const weekend = d ? !d.workday : /^(Sun)/.test(r.label)
          return (
            <g key={r.key}>
              {weekend && <rect x={0} y={y} width={W} height={rowH} fill="#e8f0f7" opacity={0.03} />}
              <text x={LG - 6} y={cy + 3} textAnchor="end" fontSize={8.5} fill={weekend ? '#4f6478' : '#6f88a0'} fontFamily="var(--font-mono)">
                {r.label}
              </text>
              {d?.firstMoveMin != null && d.lastMoveMin != null && (
                <>
                  <line x1={xOf(d.firstMoveMin)} y1={cy} x2={xOf(Math.max(d.lastMoveMin, d.firstMoveMin + 4))} y2={cy}
                    stroke="#ff9e16" strokeWidth={3.5} strokeLinecap="round" opacity={0.92} />
                  {d.firstOnSiteMin != null && (
                    <circle cx={xOf(d.firstOnSiteMin)} cy={cy} r={2.4} fill="#e8f0f7" stroke="#00203a" strokeWidth={1} />
                  )}
                </>
              )}
              {d && d.miles > 0.5 && (
                <text x={W - 4} y={cy + 3} textAnchor="end" fontSize={8.5} fill="#6f88a0" fontFamily="var(--font-mono)">
                  {Math.round(d.miles)} mi
                </text>
              )}
              {/* hover target with the day's story */}
              <rect x={0} y={y} width={W} height={rowH} fill="transparent">
                <title>
                  {d?.firstMoveMin != null
                    ? `${r.label} — first move ${fmtClock(d.firstMoveMin)}${d.firstOnSiteMin != null ? ` · on site ${fmtClock(d.firstOnSiteMin)}` : ''} · last ${fmtClock(d.lastMoveMin)} · ${Math.round(d.miles)} mi${d.afterHoursMiles >= 1 ? ` · ${Math.round(d.afterHoursMiles)} mi after hours` : ''}`
                    : `${r.label} — no movement`}
                </title>
              </rect>
            </g>
          )
        })}
      </svg>
      <p className="text-[10px] text-faint mt-0.5">
        <span className="inline-block w-2 h-2 rounded-full bg-ink border border-navy-900 align-middle mr-1" />first time on a job site
        · shaded band = work hours{clipped ? ` · last ${rows.length} days shown` : ''}
      </p>
    </div>
  )
}

// ── Stop mix ─────────────────────────────────────────────────────────────────
// Where the truck's parked time actually went. Rare work-legit kinds fold into
// "Other" so the bar stays readable; the table + top stops keep full detail.

const BAR_KINDS: PoiKind[] = ['site', 'supplier', 'fuel', 'food', 'store', 'residence', 'other']

export function foldForBar(stops: StopMix[]): StopMix[] {
  const out = new Map<PoiKind, StopMix>()
  for (const s of stops) {
    const k: PoiKind = BAR_KINDS.includes(s.kind) ? s.kind : 'other'
    const cur = out.get(k)
    if (!cur) out.set(k, { ...s, kind: k })
    else {
      cur.count += s.count
      cur.minutes += s.minutes
      cur.workMinutes += s.workMinutes
      if (s.topMinutes > cur.topMinutes) { cur.topMinutes = s.topMinutes; cur.topName = s.topName }
    }
  }
  return BAR_KINDS.map((k) => out.get(k)).filter((x): x is StopMix => !!x && x.minutes > 0)
}

export function StopMixBar({ stops }: { stops: StopMix[] }) {
  const mix = foldForBar(stops)
  const total = mix.reduce((s, m) => s + m.minutes, 0)
  if (!total) return <p className="text-xs text-faint">No stops of 5+ minutes in this range.</p>
  return (
    <div>
      <div className="flex h-4 rounded-full overflow-hidden gap-[2px]" role="img" aria-label="Stopped time by place type">
        {/* flex-grow shares, not % widths: the 2px gaps then fit INSIDE 100%
            instead of pushing the last segment past the rounded clip. */}
        {mix.map((m) => (
          <div key={m.kind} className="h-full min-w-[3px]" title={`${POI_KIND_META[m.kind].label}: ${fmtHM(m.minutes)} across ${m.count} stops`}
            style={{ flexGrow: m.minutes, flexBasis: 0, background: POI_KIND_COLOR[m.kind] }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
        {mix.map((m) => (
          <span key={m.kind} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: POI_KIND_COLOR[m.kind] }} />
            {POI_KIND_META[m.kind].label}
            <span className="font-mono text-faint">{fmtHM(m.minutes)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Fleet rhythm comparison ──────────────────────────────────────────────────
// Everyone's typical day on one clock: name → line from median first move to
// median last move. Identity is the row label, so no palette juggling.

export function FleetRhythm({ scores, workStart, workEnd }: {
  scores: VehicleScore[]
  workStart: string
  workEnd: string
}) {
  const rows = scores.filter((s) => s.medFirstMove != null && s.medLastMove != null).slice(0, 8)
  if (rows.length < 2) return null
  const sorted = [...rows].sort((a, b) => (a.medFirstMove ?? 0) - (b.medFirstMove ?? 0))
  const LGN = 128
  const xr = (min: number) => LGN + (min / 1440) * (W - LGN - 10)
  const rowH = 24
  const H = AXIS + sorted.length * rowH + 4
  const ws = toMin(workStart)
  const we = toMin(workEnd)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Median workday span per vehicle">
      <rect x={xr(ws)} y={AXIS - 3} width={xr(we) - xr(ws)} height={H - AXIS + 1} fill="#ff9e16" opacity={0.07} />
      {[360, 720, 1080].map((m) => (
        <g key={m}>
          <line x1={xr(m)} y1={AXIS - 3} x2={xr(m)} y2={H - 2} stroke="#e8f0f7" opacity={0.06} />
          <text x={xr(m)} y={AXIS - 6} textAnchor="middle" fontSize={8.5} fill="#6f88a0" fontFamily="var(--font-mono)">
            {m === 360 ? '6a' : m === 720 ? 'noon' : '6p'}
          </text>
        </g>
      ))}
      {sorted.map((s, i) => {
        const y = AXIS + i * rowH
        const cy = y + rowH / 2
        const f = s.medFirstMove!
        const l = Math.max(s.medLastMove!, f + 6)
        const name = s.name.length > 17 ? `${s.name.slice(0, 16)}…` : s.name
        return (
          <g key={s.assetId}>
            <text x={LGN - 8} y={cy + 3.5} textAnchor="end" fontSize={10.5} fill="#9fb6cc">{name}</text>
            <line x1={xr(f)} y1={cy} x2={xr(l)} y2={cy} stroke="#ff9e16" strokeWidth={3.5} strokeLinecap="round" opacity={0.92} />
            <circle cx={xr(f)} cy={cy} r={3} fill="#e8f0f7" stroke="#00203a" strokeWidth={1} />
            <circle cx={xr(l)} cy={cy} r={3} fill="#e8f0f7" stroke="#00203a" strokeWidth={1} />
            <text x={xr(f) - 6} y={cy + 3} textAnchor="end" fontSize={8.5} fill="#6f88a0" fontFamily="var(--font-mono)">{fmtClock(f)}</text>
            <text x={xr(l) + 6} y={cy + 3} textAnchor="start" fontSize={8.5} fill="#6f88a0" fontFamily="var(--font-mono)">{fmtClock(l)}</text>
            <rect x={0} y={y} width={W} height={rowH} fill="transparent">
              <title>{`${s.name} — typical day ${fmtClock(f)} to ${fmtClock(l)}${s.medFirstOnSite != null ? `, on site by ${fmtClock(s.medFirstOnSite)}` : ''}`}</title>
            </rect>
          </g>
        )
      })}
    </svg>
  )
}

// ── Active vs idle split ─────────────────────────────────────────────────────

export function SplitBar({ activeHrs, idleHrs }: { activeHrs: number; idleHrs: number }) {
  const total = activeHrs + idleHrs
  if (total <= 0) return null
  return (
    <div className="flex h-2 rounded-full overflow-hidden gap-[2px]" role="img"
      aria-label={`${activeHrs} hours working, ${idleHrs} hours idling`}
      title={`Working ${activeHrs} h · idling ${idleHrs} h`}>
      <div className="h-full bg-amber" style={{ width: `${(activeHrs / total) * 100}%` }} />
      <div className="h-full" style={{ width: `${(idleHrs / total) * 100}%`, background: '#52708c' }} />
    </div>
  )
}
