import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { Activity, AlertTriangle, Clock, Gauge, Moon, DollarSign } from 'lucide-react'
import { MOCK_COMPANY, MOCK_EQUIPMENT_RATES, buildMockScorecard } from '@/lib/mock-data'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getCurrentCompanyId, getCompanySettings } from '@/lib/db/company'
import { getFleetScorecard } from '@/lib/db/scorecard'
import { fmtClock, type VehicleScore } from '@/lib/scorecard'
import { rangeWindow, DEFAULT_TZ, fmtDay, type TimeRangeKey } from '@/lib/dates'
import { RANGES } from '@/lib/trails'
import type { AssetType } from '@/lib/types'
import { POI_KIND_META } from '@/lib/poi'
import { CountUp } from '@/components/ui/count-up'
import { DayStrip, FleetRhythm, SplitBar, StopMixBar, fmtHM } from '@/components/reports/Scorecard'
import { ScorecardExport } from '@/components/reports/ScorecardExport'

const TYPE_EMOJI: Record<AssetType, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}

// Same chips as the map timeline slider (minus Live — a report needs a
// window, and Today IS live-to-now). Same keys, same labels, same order.
const REPORT_RANGES = RANGES.filter((r) => r.key !== 'live')

interface Flag { severity: 0 | 1 | 2; text: string; assetName: string }

/** The judgment calls, in one place: what earns a card a callout chip. */
function flagsFor(s: VehicleScore, workStartMin: number): Flag[] {
  const out: Flag[] = []
  if (s.afterHoursMiles >= 10) {
    out.push({ severity: 0, assetName: s.name, text: `${s.afterHoursMiles} mi outside work hours${s.weekendMiles >= 5 ? ` (${s.weekendMiles} on weekends)` : ''}` })
  }
  const personalWork = s.stops
    .filter((m) => m.kind === 'food' || m.kind === 'store' || m.kind === 'residence')
    .reduce((sum, m) => sum + m.workMinutes, 0)
  if (s.daysActive >= 1 && personalWork >= 45 * s.daysActive) {
    out.push({ severity: 1, assetName: s.name, text: `${fmtHM(personalWork)} at food, stores or residences during work hours` })
  }
  if (s.medFirstMove != null && s.daysActive >= 3 && s.medFirstMove > workStartMin + 45) {
    out.push({ severity: 2, assetName: s.name, text: `typically rolls at ${fmtClock(s.medFirstMove)}` })
  }
  if (s.idlePct >= 40 && s.activeHrs + s.idleHrs >= 5) {
    out.push({ severity: 2, assetName: s.name, text: `${s.idlePct}% of engine time idling` })
  }
  return out
}

export default async function ReportsPage({ searchParams }: { searchParams?: { range?: string } }) {
  const companyId = await getCurrentCompanyId()
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)
  const keys = REPORT_RANGES.map((r) => r.key)
  const key = (keys.includes(searchParams?.range as TimeRangeKey) ? searchParams?.range : '7d') as TimeRangeKey

  const [assets, geofences, settings] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getCompanySettings(),
  ])
  const work = {
    work_start: settings.work_start || MOCK_COMPANY.work_start,
    work_end: settings.work_end || MOCK_COMPANY.work_end,
    work_days: settings.work_days?.length ? settings.work_days : MOCK_COMPANY.work_days,
  }

  const real = await getFleetScorecard(companyId, assets, geofences, key, tz, work)
  const window = real?.window ?? rangeWindow(tz, key, {})
  const spanDays = Math.max(1, Math.round((window.to - window.from) / 86_400_000))
  const scores: VehicleScore[] = real ? real.scores : buildMockScorecard(spanDays)

  const typeOf = (id: string): AssetType => assets.find((a) => a.id === id)?.type ?? 'vehicle'
  const rateFor = (id: string): number =>
    real ? (assets.find((a) => a.id === id)?.hourly_rate ?? 0) : (MOCK_EQUIPMENT_RATES[id] ?? 0)

  const totMiles = scores.reduce((s, v) => s + v.miles, 0)
  const totActive = Math.round(scores.reduce((s, v) => s + v.activeHrs, 0) * 10) / 10
  const totIdle = Math.round(scores.reduce((s, v) => s + v.idleHrs, 0) * 10) / 10
  const totAfter = scores.reduce((s, v) => s + v.afterHoursMiles, 0)
  const idlePct = totActive + totIdle > 0 ? Math.round((totIdle / (totActive + totIdle)) * 100) : 0
  const billable = Math.round(scores.reduce((s, v) => s + v.activeHrs * rateFor(v.assetId), 0))

  const wsMin = (() => { const [h, m] = work.work_start.split(':').map(Number); return (h || 0) * 60 + (m || 0) })()
  const allFlags = scores.flatMap((s) => flagsFor(s, wsMin)).sort((a, b) => a.severity - b.severity).slice(0, 4)

  // Zone rollup: hours per job site, with who spent them.
  const zoneMap = new Map<string, { name: string; total: number; byAsset: { name: string; hours: number }[] }>()
  for (const s of scores) {
    for (const z of s.siteHours) {
      const cur = zoneMap.get(z.id) ?? { name: z.name, total: 0, byAsset: [] }
      cur.total = Math.round((cur.total + z.hours) * 10) / 10
      cur.byAsset.push({ name: s.name, hours: z.hours })
      zoneMap.set(z.id, cur)
    }
  }
  const zones = Array.from(zoneMap.values()).sort((a, b) => b.total - a.total).slice(0, 8)

  const empty = real !== null && scores.length === 0
  const rangeSub = key === 'today' || key === 'yesterday'
    ? fmtDay(window.from, tz)
    : `${fmtDay(window.from, tz)} – ${fmtDay(Math.min(window.to - 1, Date.now()), tz)}`

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-ink">Fleet Reports</h1>
          <p className="text-xs text-faint mt-0.5">{rangeSub}{real ? '' : ' · demo data'}</p>
        </div>
        <div className="flex gap-1 ml-2 flex-wrap">
          {REPORT_RANGES.map((r) => (
            <a key={r.key} href={`/reports?range=${r.key}`}
              className={'px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-colors whitespace-nowrap ' + (key === r.key ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')}>
              {r.label}
            </a>
          ))}
        </div>
        {scores.length > 0 && (
          <div className="ml-auto">
            <ScorecardExport
              scores={scores}
              brand={{ companyName: settings.name, logoUrl: settings.logo_url }}
              rangeLabel={rangeSub}
            />
          </div>
        )}
      </div>

      <div className="p-4 space-y-6 max-w-2xl lg:max-w-6xl">
        {empty ? (
          <section className="rounded-2xl border border-navy-800 bg-navy-900 p-6 text-center">
            <p className="text-4xl mb-2">📊</p>
            <p className="text-ink font-medium">Nothing tracked in this range</p>
            <p className="text-sm text-faint mt-1">Once your trackers report movement here, first-move times, working vs idle hours, miles, stop mix, and after-hours use fill in automatically.</p>
          </section>
        ) : (
          <>
            {/* Fleet pulse */}
            <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatTile icon={<Gauge className="h-4 w-4 text-[#60a5fa]" />} label="Miles driven">
                <CountUp value={totMiles} />
              </StatTile>
              <StatTile icon={<Activity className="h-4 w-4 text-amber" />} label="Working hours">{totActive.toLocaleString()}</StatTile>
              <StatTile icon={<Clock className="h-4 w-4 text-teal" />} label="Idle share">{idlePct}%</StatTile>
              <StatTile icon={<Moon className={`h-4 w-4 ${totAfter >= 10 ? 'text-alert' : 'text-faint'}`} />} label="After-hours miles">{totAfter.toLocaleString()}</StatTile>
              <StatTile icon={<DollarSign className="h-4 w-4 text-amber" />} label="Billable value">
                {billable > 0 ? <CountUp value={billable} prefix="$" /> : <span className="text-faint text-sm font-normal">set hourly rates</span>}
              </StatTile>
            </section>

            {/* Worth a look */}
            {allFlags.length > 0 && (
              <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
                <h2 className="text-sm font-semibold text-faint uppercase tracking-wider mb-2">Worth a look</h2>
                <ul className="space-y-1.5">
                  {allFlags.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <AlertTriangle className={`h-4 w-4 mt-0.5 shrink-0 ${f.severity === 0 ? 'text-alert' : 'text-amber'}`} />
                      <span className="text-muted"><span className="text-ink font-medium">{f.assetName}</span> — {f.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Who starts when */}
            {scores.filter((s) => s.medFirstMove != null).length >= 2 && (
              <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
                <h2 className="text-sm font-semibold text-faint uppercase tracking-wider mb-1">The typical day, side by side</h2>
                <p className="text-xs text-faint mb-2">Median first move to median last move · dots mark the span · shaded band = work hours ({work.work_start}–{work.work_end})</p>
                <FleetRhythm scores={scores} workStart={work.work_start} workEnd={work.work_end} />
              </section>
            )}

            {/* Per-vehicle scorecards */}
            <div className="grid gap-4 lg:grid-cols-2">
              {scores.map((s) => {
                const flags = flagsFor(s, wsMin)
                const topStops = [...s.stops].filter((m) => m.topName && m.topMinutes > 0)
                  .sort((a, b) => b.topMinutes - a.topMinutes).slice(0, 3)
                const personalWork = s.stops
                  .filter((m) => m.kind === 'food' || m.kind === 'store' || m.kind === 'residence')
                  .reduce((sum, m) => sum + m.workMinutes, 0)
                return (
                  <section key={s.assetId} className="rounded-2xl border border-navy-800 bg-navy-900 p-4 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/assets/${s.assetId}`} className="font-semibold text-ink hover:text-amber transition-colors">
                        {TYPE_EMOJI[typeOf(s.assetId)]} {s.name}
                      </Link>
                      <span className="text-[11px] text-faint font-mono">moved {s.daysActive} of {Math.min(s.daysInRange, spanDays)} days</span>
                      {flags.slice(0, 2).map((f, i) => (
                        <span key={i} className={`text-[10.5px] px-1.5 py-0.5 rounded-full border ${f.severity === 0 ? 'border-alert/40 text-alert bg-alert/10' : 'border-amber/40 text-amber bg-amber/10'}`}>
                          {f.severity === 0 ? 'after hours' : f.severity === 1 ? 'personal time' : f.text.includes('idling') ? 'high idle' : 'late starts'}
                        </span>
                      ))}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <ClockStat label="First move" value={fmtClock(s.medFirstMove)} />
                      <ClockStat label="On a site" value={fmtClock(s.medFirstOnSite)} />
                      <ClockStat label="Last move" value={fmtClock(s.medLastMove)} />
                    </div>

                    {s.daysActive > 0 && (
                      <DayStrip days={s.days} windowFrom={window.from} windowTo={window.to} tz={tz}
                        workStart={work.work_start} workEnd={work.work_end} />
                    )}

                    <div>
                      <div className="flex justify-between text-[11px] text-faint mb-1">
                        <span><span className="text-muted font-medium">{s.activeHrs} h</span> working · <span className="text-muted font-medium">{s.idleHrs} h</span> idling ({s.idlePct}%)</span>
                        <span><span className="text-muted font-medium">{s.miles.toLocaleString()} mi</span>{s.afterHoursMiles >= 1 ? <> · <span className={s.afterHoursMiles >= 10 ? 'text-alert' : 'text-muted'}>{s.afterHoursMiles} after hrs</span></> : null}</span>
                      </div>
                      <SplitBar activeHrs={s.activeHrs} idleHrs={s.idleHrs} />
                    </div>

                    <div>
                      <p className="text-[11px] text-faint uppercase tracking-wider mb-1.5">Where the stopped time went</p>
                      <StopMixBar stops={s.stops} />
                      {personalWork >= 30 && (
                        <p className="text-[11.5px] text-muted mt-1.5">
                          <span className="text-ink font-medium">{fmtHM(personalWork)}</span> of that was food, stores or residences <span className="text-ink">inside work hours</span>.
                        </p>
                      )}
                    </div>

                    {topStops.length > 0 && (
                      <div className="text-[11.5px] text-faint space-y-0.5">
                        {topStops.map((m) => (
                          <p key={m.kind}>Longest {POI_KIND_META[m.kind].label.toLowerCase()} stop: <span className="text-muted">{m.topName}</span> · {fmtHM(m.topMinutes)}</p>
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>

            {/* Hours by job site */}
            {zones.length > 0 && (
              <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
                <h2 className="text-sm font-semibold text-faint uppercase tracking-wider mb-2">Hours by job site</h2>
                <div className="space-y-2.5">
                  {zones.map((z) => (
                    <div key={z.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-muted font-medium">{z.name}</span>
                        <span className="text-muted font-mono text-xs">{z.total} h</span>
                      </div>
                      <div className="h-2 bg-navy-800 rounded-full overflow-hidden">
                        <div className="h-full bg-amber rounded-full" style={{ width: `${(z.total / (zones[0]?.total || 1)) * 100}%` }} />
                      </div>
                      <p className="text-[11px] text-faint mt-0.5">{z.byAsset.sort((a, b) => b.hours - a.hours).map((a) => `${a.name} ${a.hours}h`).join(' · ')}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-faint mt-3">Site hours drive equipment-usage billing → see Accounting.</p>
              </section>
            )}

            {/* Everything, one table */}
            <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
              <h2 className="text-sm font-semibold text-faint uppercase tracking-wider mb-2">All the numbers</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead>
                    <tr className="text-left text-faint border-b border-navy-800">
                      <th className="py-1.5 pr-3 font-medium">Asset</th>
                      <th className="py-1.5 px-2 font-medium">Days moved</th>
                      <th className="py-1.5 px-2 font-medium">First move</th>
                      <th className="py-1.5 px-2 font-medium">On site</th>
                      <th className="py-1.5 px-2 font-medium">Last move</th>
                      <th className="py-1.5 px-2 font-medium text-right">Working h</th>
                      <th className="py-1.5 px-2 font-medium text-right">Idle %</th>
                      <th className="py-1.5 px-2 font-medium text-right">Miles</th>
                      <th className="py-1.5 px-2 font-medium text-right">After-hrs mi</th>
                      <th className="py-1.5 px-2 font-medium text-right">Weekend mi</th>
                      <th className="py-1.5 px-2 font-medium text-right">Food (work)</th>
                      <th className="py-1.5 pl-2 font-medium text-right">Stores (work)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((s) => {
                      const workMin = (k: string) => s.stops.find((m) => m.kind === k)?.workMinutes ?? 0
                      return (
                        <tr key={s.assetId} className="border-b border-navy-800/60 text-muted">
                          <td className="py-1.5 pr-3 text-ink font-medium">{s.name}</td>
                          <td className="py-1.5 px-2 font-mono">{s.daysActive}</td>
                          <td className="py-1.5 px-2 font-mono">{fmtClock(s.medFirstMove)}</td>
                          <td className="py-1.5 px-2 font-mono">{fmtClock(s.medFirstOnSite)}</td>
                          <td className="py-1.5 px-2 font-mono">{fmtClock(s.medLastMove)}</td>
                          <td className="py-1.5 px-2 font-mono text-right">{s.activeHrs}</td>
                          <td className="py-1.5 px-2 font-mono text-right">{s.idlePct}%</td>
                          <td className="py-1.5 px-2 font-mono text-right">{s.miles.toLocaleString()}</td>
                          <td className={`py-1.5 px-2 font-mono text-right ${s.afterHoursMiles >= 10 ? 'text-alert' : ''}`}>{s.afterHoursMiles}</td>
                          <td className="py-1.5 px-2 font-mono text-right">{s.weekendMiles}</td>
                          <td className="py-1.5 px-2 font-mono text-right">{fmtHM(workMin('food'))}</td>
                          <td className="py-1.5 pl-2 font-mono text-right">{fmtHM(workMin('store'))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="text-[11px] text-faint">
              Times shown in your timezone ({tz.replace(/_/g, ' ')}). Work hours {work.work_start}–{work.work_end} from Settings → Company.
              Stops count at 5+ minutes; place names via OpenStreetMap. First move = first GPS movement of the day; working vs idling uses ignition where the tracker reports it.
              {real?.sampled ? ' Long ranges use evenly-sampled GPS history — totals are close estimates.' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function StatTile({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="bg-navy-900 rounded-xl border border-navy-800 p-3">
      <div className="flex items-center gap-1.5 mb-1">{icon}</div>
      <p className="text-xl font-bold text-ink">{children}</p>
      <p className="text-xs text-faint">{label}</p>
    </div>
  )
}

function ClockStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-navy-950/60 rounded-lg border border-navy-800 px-2 py-1.5 text-center">
      <p className="font-mono font-semibold text-ink text-[15px]">{value}</p>
      <p className="text-[10px] text-faint uppercase tracking-wide">{label}</p>
    </div>
  )
}
