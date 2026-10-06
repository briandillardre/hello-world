import Link from 'next/link'
import type { DataQuality, Grade, SafetyScore, ScoreComponent } from '@/lib/driving-score'
import type { SafetyEvent } from '@/lib/db/driving'
import { fmtDateTime } from '@/lib/dates'

/**
 * Driver-safety presentation pieces, shared by /reports/safety, the asset
 * page card and /reports. Server-renderable (no hooks): identity is carried
 * by position + label + number, never by colour alone.
 */

const GRADE_TONE: Record<Grade, { ring: string; chip: string }> = {
  A: { ring: '#2dd4bf', chip: 'border-teal/40 text-teal bg-teal/10' },
  B: { ring: '#2dd4bf', chip: 'border-teal/40 text-teal bg-teal/10' },
  C: { ring: '#ff9e16', chip: 'border-amber/40 text-amber bg-amber/10' },
  D: { ring: '#ff9e16', chip: 'border-amber/40 text-amber bg-amber/10' },
  F: { ring: '#fb5d5d', chip: 'border-alert/40 text-alert bg-alert/10' },
}

/** The 0–100 ring. No score yet = an empty ring that says so. */
export function ScoreDial({ score, size = 112 }: { score: SafetyScore; size?: number }) {
  const r = 44, c = 2 * Math.PI * r
  const has = score.credible && score.score != null && score.grade != null
  const tone = has ? GRADE_TONE[score.grade as Grade] : null
  const label = has ? `Safety score ${score.score} out of 100, grade ${score.grade}` : 'No safety score yet'
  return (
    <svg width={size} height={size} viewBox="0 0 112 112" role="img" aria-label={label} className="flex-none">
      <circle cx="56" cy="56" r={r} fill="none" stroke="#073a5a" strokeWidth="9" />
      {has && (
        <circle cx="56" cy="56" r={r} fill="none" stroke={tone!.ring} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={`${(c * (score.score as number)) / 100} ${c}`} transform="rotate(-90 56 56)" />
      )}
      <text x="56" y={has ? 58 : 62} textAnchor="middle" fill="#e8f0f7" style={{ font: '700 30px var(--font-archivo), system-ui' }}>
        {has ? score.score : '—'}
      </text>
      {has && (
        <text x="56" y="80" textAnchor="middle" fill={tone!.ring} style={{ font: '700 13px var(--font-mono), monospace', letterSpacing: '0.08em' }}>
          GRADE {score.grade}
        </text>
      )}
    </svg>
  )
}

/** "87 · B" chip for tables and cards; "not yet" with the reason as its tooltip. */
export function GradeChip({ score, className = '' }: { score: SafetyScore; className?: string }) {
  if (!score.credible || score.score == null || !score.grade) {
    return <span className={`text-[11px] px-1.5 py-0.5 rounded-full border border-navy-700 text-faint whitespace-nowrap ${className}`} title={score.why ?? undefined}>not yet</span>
  }
  const blended = score.z != null && score.z < 1 && score.raw != null && score.raw !== score.score
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded-full border font-bold whitespace-nowrap ${GRADE_TONE[score.grade].chip} ${className}`}
      title={`${score.coaching}${blended ? ` (its own ${score.raw}, blended toward the fleet — under 3,000 miles)` : ''}`}>
      {score.score} · {score.grade}
    </span>
  )
}

export function TrendTag({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-faint">—</span>
  if (delta === 0) return <span className="text-faint">±0</span>
  const up = delta > 0
  return <span className={up ? 'text-teal' : 'text-alert'} title="vs the period before">{up ? '▲' : '▼'} {up ? '+' : '−'}{Math.abs(delta)}</span>
}

/** "What moved the score": each deduction, biggest first, with what was counted. */
export function WhatMoved({ components, max = 5 }: { components: ScoreComponent[]; max?: number }) {
  const shown = components.slice(0, max)
  const top = Math.max(10, ...shown.map((c) => c.points))
  return (
    <ul className="space-y-2">
      {shown.map((c) => (
        <li key={c.key}>
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="text-muted font-medium">{c.label}</span>
            <span className={`font-mono text-[11.5px] ${!c.measured ? 'text-faint' : c.points >= 5 ? 'text-alert' : c.points >= 1 ? 'text-amber' : 'text-faint'}`}>
              {!c.measured ? 'not measured' : c.points > 0 ? `−${c.points.toFixed(1)}` : '0'}
            </span>
          </div>
          <div className="h-1.5 bg-navy-800 rounded-full overflow-hidden mt-1" aria-hidden>
            <div className={`h-full rounded-full ${c.points >= 5 ? 'bg-alert' : 'bg-amber'}`} style={{ width: `${Math.min(100, (c.points / top) * 100)}%` }} />
          </div>
          <p className="text-[11px] text-faint mt-0.5">{c.detail}</p>
        </li>
      ))}
    </ul>
  )
}

/** How far to trust the numbers, as one chip. */
export function QualityChip({ q }: { q: DataQuality }) {
  const cls = q.verdict === 'poor' ? 'border-alert/40 text-alert bg-alert/10'
    : q.accelerometer === 'on' && q.verdict === 'good' ? 'border-teal/40 text-teal bg-teal/10'
      : 'border-amber/40 text-amber bg-amber/10'
  const label = q.verdict === 'poor' ? 'data gaps' : q.accelerometer === 'on' ? 'accelerometer' : q.accelerometer === 'partial' ? 'part accelerometer' : 'speed + hours only'
  const title = [
    q.accelerometer === 'on' ? 'Harsh events from the truck\'s own accelerometer, confirmed by its speed.' : 'Harsh events not measured until the accelerometer is on.',
    q.coveragePct != null ? `${q.coveragePct}% of driving recorded.` : null,
    q.unplugged ? `Unplugged ${q.unplugged}×.` : null,
  ].filter(Boolean).join(' ')
  return <span className={`text-[10.5px] px-1.5 py-0.5 rounded-full border whitespace-nowrap ${cls}`} title={title}>{label}</span>
}

export function QualityNotes({ q }: { q: DataQuality }) {
  if (!q.notes.length) return <p className="text-[11.5px] text-faint">Accelerometer on, every mile recorded, never unplugged.</p>
  return (
    <ul className="space-y-1">
      {q.notes.map((n) => <li key={n} className="text-[11.5px] text-muted leading-snug">• {n}</li>)}
    </ul>
  )
}

/** The data-quality block as a grid of plain facts (every score carries it). */
export function QualityGrid({ q }: { q: DataQuality }) {
  const pctOr = (x: number | null, none = '—') => (x == null ? none : `${x}%`)
  const cells: [string, string, boolean][] = [
    ['Harsh events', q.accelerometer === 'on' ? 'accelerometer' : q.accelerometer === 'partial' ? 'accelerometer, part of the time' : 'not measured yet', q.accelerometer !== 'on'],
    ['Confirmed · unconfirmed', `${q.confirmed} · ${q.unconfirmed}`, q.unconfirmed > 0],
    ['GPS estimates (not scored)', String(q.estimated), false],
    ['Speed source', q.speedSource === 'obd' ? 'truck speedometer' : q.speedSource === 'mixed' ? `speedometer ${q.obdPct}%` : 'GPS', q.speedSource !== 'obd'],
    ['Miles with a known limit', pctOr(q.limitPct), false],
    ['Device uptime', pctOr(q.uptimePct), q.uptimePct != null && q.uptimePct < 90],
    ['Driving recorded', pctOr(q.coveragePct), q.coveragePct != null && q.coveragePct < 95],
    ['Unplugged / power lost', String(q.unplugged), q.unplugged > 0],
    ['Jamming · towing', `${q.jamming} · ${q.towing}`, q.jamming > 0],
    ['GPS jumps refused', String(q.rejects), false],
    ['Miles tied to a driver', pctOr(q.attributedPct), false],
  ]
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
      {cells.map(([k, v, warn]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[10.5px] text-faint uppercase tracking-wide truncate">{k}</dt>
          <dd className={`text-[12.5px] font-medium ${warn ? 'text-amber' : 'text-muted'}`}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Events in plain words, newest first. */
export function EventList({ events, tz, showAsset = true, empty }: { events: SafetyEvent[]; tz: string; showAsset?: boolean; empty?: string }) {
  if (!events.length) return <p className="text-sm text-faint">{empty ?? 'No events in this period.'}</p>
  return (
    <ul className="divide-y divide-navy-800/70">
      {events.map((e) => {
        const scored = e.source === 'device' ? e.confirmed === true : e.kind === 'max_speed' || e.kind === 'zone_speeding'
        const dot = e.kind === 'crash' ? 'bg-alert' : !scored ? 'bg-navy-600' : e.severity === 'severe' ? 'bg-alert' : 'bg-amber'
        return (
          <li key={e.id} className="py-2 flex items-start gap-3">
            <span className={`mt-1.5 h-2 w-2 rounded-full flex-none ${dot}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] leading-snug ${scored || e.kind === 'crash' ? 'text-ink' : 'text-muted'}`}>
                {showAsset && <><Link href={`/reports/safety?asset=${e.assetId}`} className="font-semibold hover:text-amber">{e.assetName}</Link> — </>}
                {e.words}
              </p>
              <p className="text-[11px] text-faint mt-0.5">
                {fmtDateTime(e.at, tz)}
                {e.place ? ` · ${e.place}` : ''}
                {e.personName ? ` · ${e.personName} aboard` : ''}
                {e.lat != null && e.lng != null && (
                  <> · <Link href={`/map?lat=${e.lat.toFixed(5)}&lng=${e.lng.toFixed(5)}&z=17`} className="text-teal hover:underline">map</Link></>
                )}
              </p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** "1.2" per 1,000 mi; "—" for none; "n/a" when not measured. */
export const rate = (x: number | null) => (x == null ? 'n/a' : x > 0 ? (x >= 10 ? Math.round(x).toString() : x.toFixed(1)) : '—')
export const pct = (x: number) => (x > 0 ? `${x < 1 ? x.toFixed(1) : Math.round(x)}%` : '—')
