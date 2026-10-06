import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions, getRealPermissions } from '@/lib/permissions-server'
import { isProspect, visibleAssets } from '@/lib/permissions'
import { getCurrentCompanyId, getCompanySettings } from '@/lib/db/company'
import { getAssets } from '@/lib/db/assets'
import { getSafetyReport, insurerReady, listSafetyEvents } from '@/lib/db/driving'
import { resolveDigestPrefs } from '@/lib/weekly-digest'
import { KIND_LABEL, toCsv, type SafetyScore } from '@/lib/driving-score'
import { safeTz } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const KINDS = ['vehicles', 'months', 'events'] as const
type Kind = (typeof KINDS)[number]

/**
 * The insurer report's tables as CSV (/reports/safety/insurer): the vehicle
 * schedule with scores and rates, the monthly trend, or every event over the
 * trailing 12 months. Same gate as the report — the billing ability, never a
 * view-as preview, never a Prospective Client — and the same history floor
 * (90 days, 3 scored vehicles). No per-driver data and no coordinates: the
 * file is meant to leave the company.
 */
export async function GET(req: NextRequest) {
  const kind = new URL(req.url).searchParams.get('kind') as Kind | null
  if (!kind || !KINDS.includes(kind)) return new NextResponse('Pick vehicles, months or events', { status: 400 })
  const perms = await getMyPermissions()
  if (!perms.features.includes('reports') || !perms.canManageBilling || perms.viewingAs || isProspect(perms)) {
    return new NextResponse('Not found', { status: 404 })
  }
  if (!isMock) {
    const real = await getRealPermissions()
    if (!real.userId) return new NextResponse('Sign in', { status: 401 })
  }
  const [companyId, settings] = await Promise.all([getCurrentCompanyId(), getCompanySettings()])
  const tz = safeTz(resolveDigestPrefs(settings.digest_prefs).tz)
  const assets = visibleAssets((await getAssets(companyId)).filter((a) => a.active), perms)
    .map((a) => ({ id: a.id, name: a.name, type: a.type, tracker_id: a.tracker_id, metadata: (a.metadata ?? null) as Record<string, unknown> | null }))
  let db = null
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    db = createClient()
  }
  const report = await getSafetyReport(db, { companyId, tz, days: 365, assets, drivers: 'none', withVin: true, withMonths: kind === 'months' })
  const gate = insurerReady(report)
  if (!gate.ok) {
    return new NextResponse(`Not enough history for an insurer report yet: ${gate.daysOfData} days and ${gate.scoredVehicles} scored vehicles (needs 90 and 3).`, { status: 409 })
  }

  let csv: string
  if (kind === 'vehicles') {
    csv = toCsv(
      ['Vehicle', 'Year', 'Make', 'Model', 'VIN', 'Plate', 'Class', 'Miles', 'Moving hours', 'Engine hours',
        'Score', 'Grade', 'Own score before blending', 'Credibility weight', 'Risk band',
        'Hard braking per 1k mi', 'Hard cornering per 1k mi', 'Hard launches per 1k mi',
        'Hard braking events', 'Hard braking severe', 'Hard cornering events', 'Hard launch events',
        'Unconfirmed accelerometer events', 'GPS-estimated hard stops (not scored)', 'Possible impacts',
        'Severe speeding % time', 'Heavy speeding % time', 'Moderate speeding % time', 'Top-speed runs',
        'Late night % time (12-4 AM)', 'Evening % time (10 PM-12, not scored)',
        'Accelerometer', 'Speed source', 'Miles with known limit %', 'Device uptime %', 'Driving recorded %',
        'Unplugged or lost power', 'Jamming events', 'Towing events', 'GPS jumps refused', 'Data quality'],
      report.vehicles.map((v) => [
        v.name, v.ident.year, v.ident.make, v.ident.model, v.ident.vin, v.ident.plate, v.vehicleClass === 'heavy' ? 'medium/heavy' : 'light',
        round1(v.score.miles), round1(v.score.hours), v.score.engineHours ? round1(v.score.engineHours) : '',
        ...scoreCells(v.score),
        v.score.per1000.harsh_brake, v.score.per1000.harsh_corner, v.score.per1000.harsh_accel,
        v.score.counts.harsh_brake, v.score.counts.harsh_brake_severe, v.score.counts.harsh_corner, v.score.counts.harsh_accel,
        v.score.quality.unconfirmed, v.score.counts.est_brake, v.score.counts.crash,
        v.score.speedPct.severe, v.score.speedPct.heavy, v.score.speedPct.moderate, v.score.counts.max_speed,
        v.score.lateNightPct, v.score.eveningPct,
        v.score.quality.accelerometer, v.score.quality.speedSource, v.score.quality.limitPct, v.score.quality.uptimePct, v.score.quality.coveragePct,
        v.score.quality.unplugged, v.score.quality.jamming, v.score.quality.towing, v.score.quality.rejects, v.score.quality.verdict,
      ]),
    )
  } else if (kind === 'months') {
    csv = toCsv(
      ['Month', 'Vehicles driven', 'Miles', 'Moving hours', 'Score', 'Grade', 'Own score before blending', 'Credibility weight', 'Risk band',
        'Hard braking per 1k mi', 'Hard cornering per 1k mi', 'Hard launches per 1k mi',
        'Severe speeding % time', 'Heavy speeding % time', 'Moderate speeding % time', 'Top-speed runs', 'Late night % time', 'Possible impacts', 'Accelerometer'],
      report.months.map((m) => [
        m.month, m.vehicles, round1(m.score.miles), round1(m.score.hours), ...scoreCells(m.score),
        m.score.per1000.harsh_brake, m.score.per1000.harsh_corner, m.score.per1000.harsh_accel,
        m.score.speedPct.severe, m.score.speedPct.heavy, m.score.speedPct.moderate, m.score.counts.max_speed, m.score.lateNightPct,
        m.score.counts.crash, m.score.quality.accelerometer,
      ]),
    )
  } else {
    const events = await listSafetyEvents(db, { companyId, tz, fromKey: report.fromKey, toKey: report.toKey, assets })
    const vin = new Map(report.vehicles.map((v) => [v.assetId, v.ident.vin]))
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    csv = toCsv(
      ['Date', `Time (${tz})`, 'Vehicle', 'VIN', 'Event', 'Severity', 'Source', 'Scored', 'Peak g or mph', 'Speed mph', 'Duration s', 'Posted limit mph', 'Site', 'In words'],
      events.map((e) => {
        const speeding = e.kind === 'max_speed' || e.kind === 'zone_speeding'
        // Scored: speeding, and accelerometer events the speed confirmed.
        // Listed only: unconfirmed spikes, GPS estimates, possible impacts.
        const scored = speeding || (e.source === 'device' && e.kind !== 'crash' && e.confirmed === true)
        return [
          date.format(e.at), time.format(e.at), e.assetName, vin.get(e.assetId) ?? '', KIND_LABEL[e.kind], e.severity,
          speeding ? 'speed' : e.source === 'device' ? 'accelerometer' : 'GPS estimate',
          scored ? 'yes' : 'no', e.value, e.speedMph, e.durationS, e.limitMph, e.zoneName ?? '', e.words,
        ]
      }),
    )
  }
  const name = `${(settings.name || 'fleet').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'fleet'}-safety-${kind}-${report.toKey}.csv`
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  })
}

const round1 = (x: number) => Math.round(x * 10) / 10

function scoreCells(s: SafetyScore): unknown[] {
  if (!s.credible || s.score == null) return [s.why ? `not scored: ${s.why}` : 'not scored', '', '', '', '']
  return [s.score, s.grade, s.raw, s.z == null ? '' : Math.round(s.z * 100) / 100, s.band]
}
