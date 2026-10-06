import type { ReactNode } from 'react'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, visibleAssets } from '@/lib/permissions'
import { getCurrentCompanyId, getCompanySettings } from '@/lib/db/company'
import { getAssets } from '@/lib/db/assets'
import { getSafetyReport, isScoredAsset, safetyDays, SAFETY_PERIODS } from '@/lib/db/driving'
import { resolveDigestPrefs } from '@/lib/weekly-digest'
import { SAFETY_METHOD } from '@/lib/driving-score'
import { fmtDay, safeTz, zonedMidnightMs } from '@/lib/dates'
import { EventList, GradeChip, QualityChip, QualityGrid, QualityNotes, ScoreDial, TrendTag, WhatMoved, pct, rate } from '@/components/reports/SafetyBits'

export const metadata = { title: 'HammerTrack — Driver safety' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Driver safety scores — HammerTrack Safety Score v1 (migration 129,
 * lib/driving-score.ts): the fleet, each road vehicle, each driver who rode
 * alone, and the events behind them, every score with its data-quality
 * block. Same view level as Reports. Driving is people-shaped data: a
 * Prospective Client sees that it exists, not what it says.
 */
export default async function SafetyPage({ searchParams }: { searchParams?: { days?: string; asset?: string } }) {
  const perms = await requireFeature('reports')
  const [real, companyId, settings] = await Promise.all([getRealPermissions(), getCurrentCompanyId(), getCompanySettings()])
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const days = safetyDays(searchParams?.days, 90)

  if (isProspect(perms)) {
    return (
      <Shell days={days} assetQuery={null} canInsurer={false}>
        <section className="rounded-2xl border border-navy-800 bg-navy-900 p-6 text-center">
          <ShieldCheck className="h-8 w-8 text-teal mx-auto mb-2" />
          <p className="text-ink font-medium">Driver safety scores are kept to the company&apos;s own team</p>
          <p className="text-sm text-faint mt-1">They describe how people drive, so they are not shared with this login.</p>
        </section>
      </Shell>
    )
  }

  const companyTz = safeTz(resolveDigestPrefs(settings.digest_prefs).tz)
  const all = visibleAssets((await getAssets(companyId)).filter((a) => a.active), perms)
  const assets = all.map((a) => ({ id: a.id, name: a.name, type: a.type, tracker_id: a.tracker_id, metadata: (a.metadata ?? null) as Record<string, unknown> | null }))
  const pick = searchParams?.asset && assets.some((a) => a.id === searchParams.asset) ? searchParams.asset : null
  let db = null
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    db = createClient()
  }
  const report = await getSafetyReport(db, {
    companyId, tz: companyTz, days, assets,
    drivers: { viewerRank: rankOf(perms), viewerId: perms.viewingAs?.id ?? real.userId },
    eventsFor: pick, eventLimit: 40, withPrior: days <= 90, withPlaces: true,
  })
  const canInsurer = perms.canManageBilling && !perms.viewingAs
  const picked = pick ? report.vehicles.find((v) => v.assetId === pick) ?? null : null
  const periodLabel = `${fmtDay(zonedMidnightMs(report.fromKey, companyTz), companyTz)} – ${fmtDay(zonedMidnightMs(report.toKey, companyTz), companyTz)}`
  const scoredCount = assets.filter(isScoredAsset).length
  const C = SAFETY_METHOD.credibility

  return (
    <Shell days={days} assetQuery={pick} canInsurer={canInsurer} sub={`${periodLabel}${report.demo ? ' · demo data' : ''}`}>
      {!report.ready && (
        <p className="rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm text-amber">Driver scores are still being set up on this account — they fill in within a few hours.</p>
      )}

      {/* The fleet */}
      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4 space-y-4">
        <div className="grid gap-4 lg:grid-cols-[auto_1fr_1fr] items-start">
          <div className="flex items-center gap-4">
            <ScoreDial score={report.fleet} />
            <div>
              <p className="text-[11px] text-faint uppercase tracking-wider">Fleet safety score</p>
              <p className="text-ink font-semibold mt-0.5">{report.vehicles.length} {report.vehicles.length === 1 ? 'vehicle' : 'vehicles'} · {Math.round(report.fleet.miles).toLocaleString()} mi · {report.fleet.hours} h</p>
              <p className="text-[12px] text-muted mt-1">vs the {days} days before: <TrendTag delta={report.fleetTrend} /></p>
              <div className="mt-1.5"><QualityChip q={report.fleet.quality} /></div>
            </div>
          </div>
          <div>
            <p className="text-[11px] text-faint uppercase tracking-wider mb-1.5">{report.fleet.credible ? 'What moved the score' : 'Not scored yet'}</p>
            {report.fleet.credible ? <WhatMoved components={report.fleet.components} /> : <p className="text-sm text-muted">{report.fleet.why}</p>}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] text-faint uppercase tracking-wider">Worth saying</p>
            <p className="text-sm text-ink leading-snug">{report.fleet.coaching}</p>
            <p className="text-[11px] text-faint uppercase tracking-wider pt-1">Raw rates</p>
            <p className="text-[12px] text-muted leading-relaxed">
              Hard stops {rate(report.fleet.per1000.harsh_brake)} · corners {rate(report.fleet.per1000.harsh_corner)} · launches {rate(report.fleet.per1000.harsh_accel)} per 1,000 mi
              {report.fleet.per100EngineHours != null ? ` · ${report.fleet.per100EngineHours} per 100 engine hours` : ''}
              {' · '}speeding {pct(report.fleet.speedPct.severe)} severe, {pct(report.fleet.speedPct.heavy)} heavy, {pct(report.fleet.speedPct.moderate)} moderate of driving
              {' · '}late night {pct(report.fleet.lateNightPct)}
              {report.fleet.counts.crash ? ` · ${report.fleet.counts.crash} possible impact${report.fleet.counts.crash === 1 ? '' : 's'} (listed, not scored)` : ''}
            </p>
          </div>
        </div>
        <details className="group border-t border-navy-800 pt-3">
          <summary className="cursor-pointer text-[11.5px] text-faint uppercase tracking-wider hover:text-ink">How far to trust it ▾</summary>
          <div className="mt-3 space-y-3">
            <QualityGrid q={report.fleet.quality} />
            <QualityNotes q={report.fleet.quality} />
          </div>
        </details>
      </section>

      {/* Every vehicle */}
      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
        <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Vehicles</h2>
          <span className="text-[11px] text-faint">harsh events per 1,000 mi · speeding and late night as % of driving · worst first</span>
        </div>
        {report.vehicles.length === 0 ? (
          <p className="text-sm text-faint">
            {scoredCount === 0 ? 'No road vehicles with an OBD or wired tracker yet — scores start the day one is installed. Machines are never scored.' : 'No driving recorded in this period yet.'}
          </p>
        ) : (
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-navy-900 to-transparent sm:hidden" aria-hidden />
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead>
                  <tr className="text-left text-faint border-b border-navy-800">
                    <th className="py-1.5 pr-3 font-medium">Vehicle</th>
                    <th className="py-1.5 px-2 font-medium">Score</th>
                    <th className="py-1.5 px-2 font-medium text-right">Miles</th>
                    <th className="py-1.5 px-2 font-medium text-right" title="Confirmed accelerometer hard stops per 1,000 miles">Hard stops</th>
                    <th className="py-1.5 px-2 font-medium text-right" title="Confirmed hard cornering per 1,000 miles">Corners</th>
                    <th className="py-1.5 px-2 font-medium text-right" title="Confirmed hard launches per 1,000 miles">Launches</th>
                    <th className="py-1.5 px-2 font-medium text-right" title="Share of driving in severe / heavy / moderate speeding">Speeding</th>
                    <th className="py-1.5 px-2 font-medium text-right" title="Share of driving midnight–4 AM">Late night</th>
                    <th className="py-1.5 px-2 font-medium">Trend</th>
                    <th className="py-1.5 pl-2 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {report.vehicles.map((v) => {
                    const est = v.score.counts.est_brake + v.score.counts.est_accel
                    return (
                      <tr key={v.assetId} className={`border-b border-navy-800/60 text-muted ${v.assetId === pick ? 'bg-navy-800/40' : ''}`}>
                        <td className="py-1.5 pr-3 text-ink font-medium">
                          <Link href={`/reports/safety?days=${days}&asset=${v.assetId}`} className="hover:text-amber">{v.name}</Link>
                          {v.vehicleClass === 'heavy' && <span className="ml-1.5 text-[10px] text-faint font-normal" title="Medium/heavy thresholds">heavy</span>}
                        </td>
                        <td className="py-1.5 px-2"><GradeChip score={v.score} /></td>
                        <td className="py-1.5 px-2 font-mono text-right">{Math.round(v.score.miles).toLocaleString()}</td>
                        <td className="py-1.5 px-2 font-mono text-right" title={est ? `${est} estimated from GPS (not scored)` : undefined}>
                          {rate(v.score.per1000.harsh_brake)}{v.score.per1000.harsh_brake == null && v.score.counts.est_brake ? <span className="text-faint"> · est {v.score.counts.est_brake}</span> : null}
                        </td>
                        <td className="py-1.5 px-2 font-mono text-right">{rate(v.score.per1000.harsh_corner)}</td>
                        <td className="py-1.5 px-2 font-mono text-right">{rate(v.score.per1000.harsh_accel)}</td>
                        <td className="py-1.5 px-2 font-mono text-right">{pct(v.score.speedPct.severe)} / {pct(v.score.speedPct.heavy)} / {pct(v.score.speedPct.moderate)}</td>
                        <td className="py-1.5 px-2 font-mono text-right">{pct(v.score.lateNightPct)}</td>
                        <td className="py-1.5 px-2 font-mono"><TrendTag delta={v.trend} /></td>
                        <td className="py-1.5 pl-2"><QualityChip q={v.score.quality} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* One vehicle, opened */}
      {picked && (
        <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[auto_1fr_1fr]">
            <div className="flex items-center gap-4">
              <ScoreDial score={picked.score} size={96} />
              <div>
                <Link href={`/assets/${picked.assetId}`} className="text-ink font-semibold hover:text-amber">{picked.name}</Link>
                <p className="text-[12px] text-muted">{Math.round(picked.score.miles).toLocaleString()} mi · {picked.score.hours} h · top {picked.totals.maxMph} mph · {picked.vehicleClass === 'heavy' ? 'medium/heavy' : 'light'} thresholds</p>
                {picked.score.z != null && picked.score.z < 1 && picked.score.raw != null && (
                  <p className="text-[11px] text-faint">its own {picked.score.raw}, blended toward the fleet until 3,000 mi</p>
                )}
                <div className="mt-1.5"><QualityChip q={picked.score.quality} /></div>
              </div>
            </div>
            <div>
              <p className="text-[11px] text-faint uppercase tracking-wider mb-1.5">What moved the score</p>
              {picked.score.credible ? <WhatMoved components={picked.score.components} /> : <p className="text-sm text-muted">{picked.score.why}</p>}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-faint uppercase tracking-wider">Worth saying</p>
              <p className="text-sm text-ink leading-snug">{picked.score.coaching}</p>
            </div>
          </div>
          <div className="border-t border-navy-800 pt-3 space-y-3">
            <QualityGrid q={picked.score.quality} />
            <QualityNotes q={picked.score.quality} />
          </div>
        </section>
      )}

      {/* Drivers */}
      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
        <div className="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Drivers</h2>
          <span className="text-[11px] text-faint">scored only on time they rode alone</span>
        </div>
        {report.drivers.length === 0 ? (
          <p className="text-sm text-faint">
            No driver scores yet. A drive is matched to a person when their phone, clocked in on the app, rides along in the truck —
            and it only counts toward their score when they were the only phone aboard (with two, nobody knows who drove).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="text-left text-faint border-b border-navy-800">
                  <th className="py-1.5 pr-3 font-medium">Driver</th>
                  <th className="py-1.5 px-2 font-medium">Score</th>
                  <th className="py-1.5 px-2 font-medium text-right">Miles alone</th>
                  <th className="py-1.5 px-2 font-medium text-right">Rode along</th>
                  <th className="py-1.5 px-2 font-medium text-right">Hard stops</th>
                  <th className="py-1.5 px-2 font-medium text-right">Speeding</th>
                  <th className="py-1.5 pl-2 font-medium">Worth saying</th>
                </tr>
              </thead>
              <tbody>
                {report.drivers.map((d) => (
                  <tr key={d.personId} className="border-b border-navy-800/60 text-muted align-top">
                    <td className="py-1.5 pr-3 text-ink font-medium">{d.name}{d.isSelf ? <span className="text-faint font-normal"> (you)</span> : null}</td>
                    <td className="py-1.5 px-2"><GradeChip score={d.score} /></td>
                    <td className="py-1.5 px-2 font-mono text-right">{Math.round(d.score.miles).toLocaleString()}</td>
                    <td className="py-1.5 px-2 font-mono text-right">{Math.round(d.rodeMiles).toLocaleString()}</td>
                    <td className="py-1.5 px-2 font-mono text-right">{d.score.per1000.harsh_brake == null ? 'n/a' : d.score.counts.harsh_brake || '—'}</td>
                    <td className="py-1.5 px-2 font-mono text-right">{pct(d.score.speedPct.severe + d.score.speedPct.heavy + d.score.speedPct.moderate)}</td>
                    <td className="py-1.5 pl-2 whitespace-normal min-w-[220px] text-[11.5px]">{d.score.credible ? d.score.coaching : d.score.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Events */}
      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
        <div className="flex items-baseline justify-between mb-1 gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">{picked ? `${picked.name} — events` : 'Recent events'}</h2>
          {picked && <Link href={`/reports/safety?days=${days}`} className="text-[11.5px] text-teal hover:underline">all vehicles</Link>}
        </div>
        <EventList events={report.events} tz={tz} showAsset={!picked} empty={noEventsWords((picked?.score ?? report.fleet).quality.accelerometer, !!picked)} />
      </section>

      <p className="text-[11px] text-faint leading-relaxed">
        HammerTrack Safety Score v{SAFETY_METHOD.version}. Scores start after {C.minMiles} miles and {C.minHours} hours of driving in the period, and lean toward the fleet&apos;s score until {C.fullMiles.toLocaleString()} miles.
        {' '}Harsh events count only from the truck&apos;s own accelerometer, confirmed by its speed; until it is switched on they are not measured, and stops estimated from GPS speed are shown for coaching only.
        {' '}Speeding = {SAFETY_METHOD.maxSpeed.light}+ mph ({SAFETY_METHOD.maxSpeed.heavy} for heavy trucks) for {SAFETY_METHOD.maxSpeed.minS} s, or over a site&apos;s own posted limit. Late night = midnight to 4 AM, company time. Possible impacts are listed, never scored. Machines are never scored.
        {canInsurer ? <> The <Link href="/reports/safety/insurer" className="text-teal hover:underline">insurer report</Link> has the full method.</> : null}
      </p>
    </Shell>
  )
}

/** An empty event list says only what was measured: with the accelerometer
 *  off, "no hard stops" would be a zero nobody measured. */
function noEventsWords(accel: 'on' | 'partial' | 'off', oneVehicle: boolean): string {
  if (accel === 'on') return oneVehicle ? 'No events for this vehicle in this period.' : 'No events in this period — no hard stops, corners, launches, impacts or speeding.'
  if (accel === 'partial') {
    return `No events ${oneVehicle ? 'for this vehicle ' : ''}in this period. Hard stops, corners, launches and impacts are only measured on the days ${oneVehicle ? 'its' : 'a truck\'s'} accelerometer was on.`
  }
  return oneVehicle
    ? 'No events for this vehicle in this period. Hard stops, corners, launches and impacts aren\'t measured until its accelerometer is on.'
    : 'No events in this period. Hard stops, corners, launches and impacts aren\'t measured until the trucks\' accelerometers are on.'
}

function Shell({ children, days, assetQuery, canInsurer, sub }: { children: ReactNode; days: number; assetQuery: string | null; canInsurer: boolean; sub?: string }) {
  const q = (d: number) => `/reports/safety?days=${d}${assetQuery ? `&asset=${assetQuery}` : ''}`
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3 flex-wrap">
        <Link href="/reports" aria-label="Back to reports" className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-navy-800">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-ink">Driver safety</h1>
          {sub && <p className="text-xs text-faint mt-0.5">{sub}</p>}
        </div>
        <div className="flex gap-1 ml-2">
          {SAFETY_PERIODS.map((d) => (
            <Link key={d} href={q(d)} prefetch={false}
              className={'px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-colors whitespace-nowrap ' + (days === d ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')}>
              {d === 365 ? '12 months' : `${d} days`}
            </Link>
          ))}
        </div>
        {canInsurer && (
          <Link href="/reports/safety/insurer" className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink hover:bg-navy-800">
            <FileText className="h-4 w-4" /> Insurer report
          </Link>
        )}
      </div>
      <div className="p-4 space-y-5 max-w-2xl lg:max-w-6xl">{children}</div>
    </div>
  )
}
