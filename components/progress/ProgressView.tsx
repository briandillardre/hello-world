'use client'

/**
 * Drone flights on the timeline (Plans & Takeoff phase 5): every flight of
 * the site measured against its dirt takeoff — what is left to cut and fill,
 * how much of the design is done, flight by flight, and that day's cut /
 * fill-to-grade picture on the satellite as you step through the flights.
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plane, Loader2, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { movedBetween } from '@/lib/dirt/progress'
import type { ProgressRow } from '@/lib/db/progress'
import type { SurfaceSummary } from '@/lib/db/dirt'
import { measureProgressAction } from '@/lib/actions/progress'
import { CUT_STEPS, FILL_STEPS, NEUTRAL } from '@/lib/dirt/heat-colors'

const ProgressMap = dynamic(() => import('./ProgressMap'), { ssr: false })

const n0 = (v: number) => Math.round(v).toLocaleString('en-US')
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function ProgressView({ zone, addon, takeoffs, takeoffId, flights, progress, canEdit, demo }: {
  zone: { id: string; name: string; ring: [number, number][] | null }
  addon: boolean
  takeoffs: { id: string; name: string; stale: boolean }[]
  takeoffId: string | null
  flights: SurfaceSummary[]
  progress: ProgressRow[]
  canEdit: boolean
  demo: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const byFlight = useMemo(() => new Map(progress.map((p) => [p.surfaceId, p])), [progress])
  // Measured flights, oldest → newest: the timeline.
  const measured = useMemo(() => [...progress].sort((a, b) => a.flownOn.localeCompare(b.flownOn)), [progress])
  const [at, setAt] = useState(() => Math.max(0, measured.length - 1))
  // A newly measured flight takes the timeline to the newest.
  useEffect(() => { setAt(Math.max(0, measured.length - 1)) }, [measured.length])
  const [opacity, setOpacity] = useState(0.75)
  const cur = measured[Math.min(at, measured.length - 1)] ?? null
  const moved = useMemo(() => {
    const newest = [...measured].reverse()
    const m = movedBetween(newest.map((p) => p.results))
    return new Map(newest.map((p, i) => [p.id, m[i]]))
  }, [measured])
  const takeoff = takeoffs.find((t) => t.id === takeoffId) ?? null

  async function measure(surfaceId: string, asFlown = false) {
    if (!takeoffId) return
    setBusy(surfaceId); setErr(null)
    const r = await measureProgressAction({ takeoffId, surfaceId, asFlown }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr(r && !r.ok ? r.error : 'Couldn’t measure that flight — try again.'); return }
    router.refresh()
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <Link href={`/plans/${zone.id}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink mb-2"><ArrowLeft className="h-4 w-4" /> Plan room</Link>
          <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><Plane className="h-5 w-5 text-amber" /> Progress · {zone.name}</h1>
          <p className="text-[12.5px] text-faint">Each drone flight is the ground on the day it was flown. Run against the site&apos;s dirt takeoff, it says what is left to cut and fill — levelled first on the untouched ground around the grading limits, so a drone without survey control still lands on the plans&apos; datum.</p>
        </div>

        {demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">Demo mode — sign in to measure a site&apos;s flights.</p>}
        {!demo && !addon && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">Progress by flight is part of the dirt takeoff add-on — ask us to turn it on for your company.</p>}
        {addon && !takeoff && !demo && <p className="rounded-xl border border-navy-700 bg-navy-900/60 px-3 py-2 text-[12.5px] text-muted">Save the site&apos;s dirt takeoff first — flights are measured against its saved design.</p>}
        {err && <p className="flex items-start gap-2 rounded-xl border border-red-400/40 bg-red-950/30 px-3 py-2 text-[12.5px] text-red-200"><AlertTriangle className="h-4 w-4 mt-0.5 flex-none" /> {err}</p>}

        {addon && takeoff && (
          <>
            <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
              {takeoffs.length > 1 ? (
                <select value={takeoff.id} onChange={(e) => router.push(`/plans/${zone.id}/progress?takeoff=${e.target.value}`)} className="rounded-xl border border-navy-700 bg-navy-950 px-3 py-2 text-ink">
                  {takeoffs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : <span className="text-muted">Against <Link href={`/dirt/${takeoff.id}`} className="text-amber">{takeoff.name}</Link></span>}
              <Link href={`/dirt/stockpiles/${zone.id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-muted hover:text-ink">Upload a flight (DSM)</Link>
              {takeoff.stale && <span className="text-amber">The takeoff changed since its last save — save it, then measure again.</span>}
            </div>

            {cur && (
              <section className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <Big label="Done" value={`${cur.results.pctDone.toFixed(0)}%`} sub={`as of ${day(cur.flownOn)}`} />
                  <Big label="Cut left" value={`${n0(cur.results.cutLeftCy)} CY`} sub={`of ${n0(cur.results.cutCy)}`} />
                  <Big label="Fill left" value={`${n0(cur.results.fillLeftCy)} CY`} sub={`of ${n0(cur.results.fillCy)}`} />
                </div>
                {measured.length > 1 && <DoneChart rows={measured} at={at} onPick={setAt} />}
                <div className="space-y-2">
                  {cur.heatUrl && cur.heatCorners
                    ? <ProgressMap ring={zone.ring} picture={{ url: cur.heatUrl, corners: cur.heatCorners }} opacity={opacity} />
                    : <p className="text-[12.5px] text-faint">No picture for this flight.</p>}
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <button onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at <= 0} aria-label="Earlier flight" className="p-2 text-ink disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                    <input type="range" min={0} max={Math.max(0, measured.length - 1)} value={at} onChange={(e) => setAt(Number(e.target.value))} className="flex-1 accent-amber" aria-label="Flight" disabled={measured.length < 2} />
                    <button onClick={() => setAt((i) => Math.min(measured.length - 1, i + 1))} disabled={at >= measured.length - 1} aria-label="Later flight" className="p-2 text-ink disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                    <span className="w-28 text-right text-ink tabular-nums">{day(cur.flownOn)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-faint">
                    <div className="flex flex-1 gap-0.5">{[...CUT_STEPS].reverse().map((c) => <span key={c} className="h-2 flex-1 rounded-sm" style={{ background: c }} />)}<span className="h-2 flex-1 rounded-sm" style={{ background: NEUTRAL }} />{FILL_STEPS.map((c) => <span key={c} className="h-2 flex-1 rounded-sm" style={{ background: c }} />)}</div>
                    <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 accent-amber" aria-label="Picture opacity" />
                  </div>
                  <div className="flex justify-between text-[10.5px] text-faint"><span>cut left</span><span>at grade</span><span>fill left</span></div>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">Flights</h2>
              {!flights.length && <p className="text-[12.5px] text-faint">No drone surveys on this site yet. Upload a flight&apos;s surface (DSM GeoTIFF) on Stockpiles, then measure it here.</p>}
              {flights.map((f) => {
                const p = byFlight.get(f.id)
                const mv = p ? moved.get(p.id) : null
                return (
                  <div key={f.id} className={`rounded-xl border bg-navy-950 p-2.5 text-[12.5px] ${p && cur?.id === p.id ? 'border-amber/60' : 'border-navy-800'}`}>
                    <div className="flex items-start gap-2">
                      <button className="flex-1 min-w-0 text-left space-y-0.5" onClick={() => { if (p) setAt(measured.findIndex((x) => x.id === p.id)) }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-ink">{day(f.flownOn)}</span>
                          <span className="text-muted truncate">{f.name}</span>
                        </div>
                        {p ? (
                          <>
                            <div className="text-ink">{p.results.pctDone.toFixed(0)}% done · cut left {n0(p.results.cutLeftCy)} · fill left {n0(p.results.fillLeftCy)} CY{mv != null ? ` · ${n0(mv)} CY moved since the flight before` : ''}</div>
                            <div className="text-faint">{p.results.datum.mode === 'levelled' ? `Levelled ${p.results.datum.offsetFt! > 0 ? '+' : ''}${p.results.datum.offsetFt} ft on the ground around the limits (±${p.results.datum.spreadFt} ft)` : 'Used as flown'} · {p.results.resolutionM} m grid</div>
                            {p.results.warnings.map((w) => <div key={w} className="text-amber">• {w}</div>)}
                          </>
                        ) : <div className="text-faint">Not measured yet{f.words ? ` · ${f.words}` : ''}</div>}
                      </button>
                      {canEdit && (
                        <div className="flex flex-col items-end gap-1 flex-none">
                          <button onClick={() => measure(f.id)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-2.5 py-1.5 text-ink hover:bg-navy-800 disabled:opacity-50">
                            {busy === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{p ? 'Measure again' : 'Measure'}
                          </button>
                          {p && p.results.datum.mode === 'levelled' && <button onClick={() => measure(f.id, true)} disabled={!!busy} className="text-[11px] text-muted underline disabled:opacity-50">Use as flown (surveyed)</button>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Big({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-navy-800 bg-navy-950 p-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="text-[11px] text-muted">{sub}</div>
    </div>
  )
}

/** Percent done by flight date — one series, the picked flight ringed; tap a point to step the timeline there. */
function DoneChart({ rows, at, onPick }: { rows: ProgressRow[]; at: number; onPick: (i: number) => void }) {
  // Sized for a phone: ~360 px wide, so 11-unit labels render near 10 px.
  const W = 380, H = 150, L = 34, R = 14, T = 16, B = 22
  const ts = rows.map((r) => Date.parse(`${r.flownOn}T12:00:00Z`))
  const t0 = Math.min(...ts), t1 = Math.max(...ts)
  const x = (t: number) => L + (t1 > t0 ? ((t - t0) / (t1 - t0)) * (W - L - R) : (W - L - R) / 2)
  const y = (p: number) => T + (1 - p / 100) * (H - T - B)
  const pts = rows.map((r, i) => [x(ts[i]), y(r.results.pctDone)] as const)
  const ai = Math.max(0, Math.min(at, rows.length - 1))
  return (
    <figure className="rounded-2xl border border-navy-700 bg-navy-900/60 p-2">
      <figcaption className="px-1 text-[11px] text-faint">Percent of the design done, by flight</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Percent of the design done by flight date">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="stroke-navy-700" strokeWidth={1} />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" fontSize={11} className="fill-faint">{g}%</text>
          </g>
        ))}
        <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" className="stroke-amber" strokeWidth={2} strokeLinejoin="round" />
        {pts.map(([px, py], i) => (
          <g key={rows[i].id} onClick={() => onPick(i)} className="cursor-pointer">
            <title>{`${day(rows[i].flownOn)}: ${rows[i].results.pctDone.toFixed(0)}% done`}</title>
            <circle cx={px} cy={py} r={12} fill="transparent" />
            <circle cx={px} cy={py} r={i === ai ? 6 : 4} className={i === ai ? 'fill-amber stroke-ink' : 'fill-amber'} strokeWidth={i === ai ? 2 : 0} />
          </g>
        ))}
        <text x={L} y={H - 5} fontSize={11} className="fill-faint">{day(rows[0].flownOn)}</text>
        <text x={W - R} y={H - 5} fontSize={11} textAnchor="end" className="fill-faint">{day(rows[rows.length - 1].flownOn)}</text>
        <text x={Math.min(W - R, Math.max(L, pts[ai][0]))} y={pts[ai][1] - 10} fontSize={12} textAnchor={pts[ai][0] > W - R - 20 ? 'end' : pts[ai][0] < L + 20 ? 'start' : 'middle'} className="fill-ink">{rows[ai].results.pctDone.toFixed(0)}%</text>
      </svg>
    </figure>
  )
}
