import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download } from 'lucide-react'
import { requireFeature } from '@/lib/permissions-server'
import { isProspect, visibleAssets } from '@/lib/permissions'
import { getCurrentCompanyId, getCompanySettings } from '@/lib/db/company'
import { getAssets } from '@/lib/db/assets'
import { getSafetyReport, insurerReady } from '@/lib/db/driving'
import { resolveDigestPrefs } from '@/lib/weekly-digest'
import { SAFETY_METHOD, type SafetyScore } from '@/lib/driving-score'
import { methodSections } from '@/lib/driving-method'
import { fmtDay, safeTz, zonedMidnightMs } from '@/lib/dates'
import { PrintButton } from '@/components/reports/PrintButton'

export const metadata = { title: 'HammerTrack — Fleet safety report' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The insurer report — the company's own driving data, laid out the way an
 * underwriter reads a submission (docs/INSURANCE-TELEMATICS.md §4): the
 * trailing 12 months with a monthly trend, the vehicle schedule with VINs,
 * rates per 1,000 miles next to every score, the data-quality block and the
 * method in plain words. Printable ("Save as PDF") plus the same tables as
 * CSV. Refused under 90 days of driving or 3 scored vehicles; marked low
 * credibility under 10,000 fleet miles.
 *
 * WHO: the billing ability (owner + admins by default). This report is a
 * company document handed to an outside party — the agent or carrier — the
 * same trust level as connecting QuickBooks or managing the subscription,
 * and the person who holds the books is the one who deals with the
 * insurance. manage_team was the other candidate, but it is about people
 * inside the company, and this report deliberately carries no per-driver
 * data. A view-as preview never opens it.
 */
export default async function InsurerReportPage() {
  const perms = await requireFeature('reports')
  if (!perms.canManageBilling || perms.viewingAs || isProspect(perms)) notFound()
  const [companyId, settings] = await Promise.all([getCurrentCompanyId(), getCompanySettings()])
  const companyTz = safeTz(resolveDigestPrefs(settings.digest_prefs).tz)
  const all = visibleAssets((await getAssets(companyId)).filter((a) => a.active), perms)
  const assets = all.map((a) => ({ id: a.id, name: a.name, type: a.type, tracker_id: a.tracker_id, metadata: (a.metadata ?? null) as Record<string, unknown> | null }))
  let db = null
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    db = createClient()
  }
  const report = await getSafetyReport(db, { companyId, tz: companyTz, days: 365, assets, drivers: 'none', withVin: true, withMonths: true })
  const gate = insurerReady(report)
  const I = SAFETY_METHOD.insurer
  const from = report.firstDay && report.firstDay > report.fromKey ? report.firstDay : report.fromKey
  const period = `${fmtDay(zonedMidnightMs(from, companyTz), companyTz)}, ${from.slice(0, 4)} – ${fmtDay(zonedMidnightMs(report.toKey, companyTz), companyTz)}, ${report.toKey.slice(0, 4)}`
  const generated = new Date().toLocaleDateString('en-US', { timeZone: companyTz, year: 'numeric', month: 'long', day: 'numeric' })
  const f = report.fleet
  const q = f.quality
  const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <style>{PRINT_CSS}</style>
      <div className="ht-noprint p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3 flex-wrap">
        <Link href="/reports/safety" aria-label="Back to driver safety" className="grid place-items-center w-8 h-8 rounded-lg text-muted hover:text-ink hover:bg-navy-800">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-ink">Insurer report</h1>
          <p className="text-xs text-faint mt-0.5">Your own driving data, for you to hand to your agent or carrier{report.demo ? ' · demo data' : ''}</p>
        </div>
        {gate.ok && (
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {(['vehicles', 'months', 'events'] as const).map((k) => (
              <a key={k} href={`/api/safety/export?kind=${k}`} className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 px-3 py-1.5 text-[12.5px] text-muted hover:text-ink hover:bg-navy-800">
                <Download className="h-4 w-4" /> {k === 'vehicles' ? 'Vehicles CSV' : k === 'months' ? 'Months CSV' : 'Events CSV'}
              </a>
            ))}
            <PrintButton />
          </div>
        )}
      </div>

      <div className="p-4">
        {!gate.ok ? (
          <section className="max-w-2xl rounded-2xl border border-navy-800 bg-navy-900 p-6">
            <p className="text-ink font-medium">Not enough history for an insurer report yet</p>
            <p className="text-sm text-muted mt-1">
              An underwriter needs at least {I.minDays} days of driving and {I.minVehicles} scored vehicles — so far {gate.daysOfData} {gate.daysOfData === 1 ? 'day' : 'days'} and {gate.scoredVehicles} {gate.scoredVehicles === 1 ? 'vehicle' : 'vehicles'}.
              A vehicle is scored once it has {SAFETY_METHOD.credibility.minMiles} miles and {SAFETY_METHOD.credibility.minHours} hours of driving.
            </p>
            <p className="text-sm text-muted mt-2">Meanwhile, the accelerometer is the thing to switch on: underwriters give the most weight to harsh events measured on the truck itself.</p>
          </section>
        ) : (
          <article id="insurer-report" className="mx-auto max-w-[8.5in] rounded-xl bg-white text-[#111827] p-6 sm:p-10 shadow-xl text-[12px] leading-relaxed">
            <header className="border-b-2 border-[#111827] pb-3 mb-4">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#6b7280]">Fleet driving safety report</p>
              <h1 className="text-[22px] font-bold mt-1">{settings.name}</h1>
              <p className="text-[12px] text-[#374151] mt-1">
                {period} · trailing 12 months · generated {generated} · HammerTrack Safety Score v{SAFETY_METHOD.version}
              </p>
              <p className="text-[11px] text-[#6b7280] mt-1">
                Compiled by the company from its own vehicle telematics (cellular trackers on each vehicle) and shared at its choice. Per-driver data is not included.
              </p>
              {gate.lowCredibility && (
                <p className="mt-2 inline-block rounded border border-[#b45309] px-2 py-0.5 text-[11px] font-semibold text-[#92400e]">
                  Low credibility: under {I.lowCredibilityMiles.toLocaleString()} fleet miles in the period — read the rates with care.
                </p>
              )}
              {report.demo && <p className="mt-2 text-[11px] font-semibold text-[#92400e]">Demo data — a fictional fleet.</p>}
            </header>

            <Section n={1} title="Summary">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Fleet safety score" value={f.score != null ? `${f.score} (${f.grade})` : '—'} sub={f.band ? `${f.band} risk band` : f.why ?? ''} />
                <Stat label="Vehicles scored" value={`${gate.scoredVehicles} of ${report.vehicles.length}`} sub="road vehicles only" />
                <Stat label="Miles · moving hours" value={`${Math.round(f.miles).toLocaleString()} · ${Math.round(f.hours).toLocaleString()}`} sub={f.engineHours ? `${Math.round(f.engineHours).toLocaleString()} engine hours` : ''} />
                <Stat label="Data quality" value={q.verdict} sub={q.accelerometer === 'on' ? 'accelerometer on' : q.accelerometer === 'partial' ? 'accelerometer part of the time' : 'harsh events not measured yet'} />
              </div>
              <table className="w-full mt-3 border-collapse">
                <tbody>
                  <Row k="Hard braking (confirmed, per 1,000 mi)" v={rateText(f.per1000.harsh_brake, f.counts.harsh_brake, f.counts.harsh_brake_severe)} />
                  <Row k="Hard cornering (confirmed, per 1,000 mi)" v={rateText(f.per1000.harsh_corner, f.counts.harsh_corner)} />
                  <Row k="Hard launches (confirmed, per 1,000 mi)" v={rateText(f.per1000.harsh_accel, f.counts.harsh_accel)} />
                  <Row k="Severe speeding (share of driving time)" v={`${f.speedPct.severe}% · ${f.counts.max_speed} top-speed run${f.counts.max_speed === 1 ? '' : 's'} (${SAFETY_METHOD.maxSpeed.light}+ mph; ${SAFETY_METHOD.maxSpeed.heavy}+ heavy)`} />
                  <Row k="Heavy · moderate speeding over a posted site limit" v={`${f.speedPct.heavy}% · ${f.speedPct.moderate}% (a limit was known for ${q.limitPct ?? 0}% of miles)`} />
                  <Row k="Late-night driving (midnight–4 AM)" v={`${f.lateNightPct}% of driving · 10 PM–midnight ${f.eveningPct}% (not scored)`} />
                  <Row k="Possible impacts (listed, not scored)" v={String(f.counts.crash)} />
                  {f.per100EngineHours != null && <Row k="Confirmed harsh events per 100 engine hours" v={String(f.per100EngineHours)} />}
                </tbody>
              </table>
            </Section>

            <Section n={2} title="Monthly trend">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-left border-b border-[#111827]">
                    <Th>Month</Th><Th right>Vehicles</Th><Th right>Miles</Th><Th right>Hours</Th><Th right>Score</Th>
                    <Th right>Hard stops /1k mi</Th><Th right>Severe speeding</Th><Th right>Late night</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.months.map((m) => (
                    <tr key={m.month} className="border-b border-[#e5e7eb]">
                      <Td>{monthName(m.month)}</Td>
                      <Td right>{m.vehicles}</Td>
                      <Td right>{Math.round(m.score.miles).toLocaleString()}</Td>
                      <Td right>{Math.round(m.score.hours)}</Td>
                      <Td right>{scoreText(m.score)}</Td>
                      <Td right>{m.score.per1000.harsh_brake == null ? 'n/a' : m.score.per1000.harsh_brake}</Td>
                      <Td right>{m.score.speedPct.severe}%</Td>
                      <Td right>{m.score.lateNightPct}%</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10.5px] text-[#6b7280] mt-1">A month is scored once it holds {SAFETY_METHOD.credibility.minMiles} miles and {SAFETY_METHOD.credibility.minHours} hours of driving.</p>
            </Section>

            <Section n={3} title="Vehicle schedule and scores">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="text-left border-b border-[#111827]">
                      <Th>Vehicle</Th><Th>Year / make / model</Th><Th>VIN</Th><Th>Class</Th><Th right>Miles</Th><Th right>Score</Th>
                      <Th right>Stops /1k</Th><Th right>Corners /1k</Th><Th right>Launches /1k</Th><Th right>Severe spd</Th><Th right>Late night</Th><Th>Data</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.vehicles.map((v) => (
                      <tr key={v.assetId} className="border-b border-[#e5e7eb]">
                        <Td>{v.name}</Td>
                        <Td>{[v.ident.year, v.ident.make, v.ident.model].filter(Boolean).join(' ') || '—'}</Td>
                        <Td mono>{v.ident.vin ?? '—'}</Td>
                        <Td>{v.vehicleClass === 'heavy' ? 'medium/heavy' : 'light'}</Td>
                        <Td right>{Math.round(v.score.miles).toLocaleString()}</Td>
                        <Td right>{scoreText(v.score)}</Td>
                        <Td right>{v.score.per1000.harsh_brake ?? 'n/a'}</Td>
                        <Td right>{v.score.per1000.harsh_corner ?? 'n/a'}</Td>
                        <Td right>{v.score.per1000.harsh_accel ?? 'n/a'}</Td>
                        <Td right>{v.score.speedPct.severe}%</Td>
                        <Td right>{v.score.lateNightPct}%</Td>
                        <Td>{v.score.quality.verdict}{v.score.quality.unplugged ? ` · unplugged ${v.score.quality.unplugged}×` : ''}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10.5px] text-[#6b7280] mt-1">Vehicles under {SAFETY_METHOD.credibility.fullMiles.toLocaleString()} miles are blended toward the fleet score (square-root credibility). &quot;n/a&quot; = the accelerometer was off, so harsh events were not measured.</p>
            </Section>

            <Section n={4} title="Data quality">
              <table className="w-full border-collapse">
                <tbody>
                  <Row k="Harsh-event source" v={q.accelerometer === 'on' ? 'Tracker accelerometer, each event confirmed by the speed stream' : q.accelerometer === 'partial' ? 'Tracker accelerometer for part of the period' : 'Not measured yet (accelerometer off)'} />
                  <Row k="Accelerometer events confirmed · unconfirmed" v={`${q.confirmed} · ${q.unconfirmed} (unconfirmed are listed, not scored)`} />
                  <Row k="Speed source" v={q.speedSource === 'obd' ? 'The vehicles\' own speedometers (OBD)' : q.speedSource === 'mixed' ? `Own speedometer for ${q.obdPct}% of driving, GPS for the rest` : 'GPS'} />
                  <Row k="Miles with a known posted limit" v={`${q.limitPct ?? 0}%`} />
                  <Row k="Device uptime (vehicle-days reporting)" v={q.uptimePct != null ? `${q.uptimePct}%` : '—'} />
                  <Row k="Driving time actually recorded" v={q.coveragePct != null ? `${q.coveragePct}%` : '—'} />
                  <Row k="Tracker unplugged or lost vehicle power" v={String(q.unplugged)} />
                  <Row k="GPS / cell jamming · towing events" v={`${q.jamming} · ${q.towing}`} />
                  <Row k="Impossible GPS jumps refused at ingest" v={String(q.rejects)} />
                  <Row k="Miles tied to a named driver" v={q.attributedPct != null ? `${q.attributedPct}%` : '—'} />
                </tbody>
              </table>
            </Section>

            <Section n={5} title="Method">
              <div className="space-y-3">
                {methodSections().map((s) => (
                  <div key={s.title}>
                    <h3 className="font-semibold text-[12.5px]">{s.title}</h3>
                    {s.body.map((p, i) => <p key={i} className="text-[11.5px] text-[#374151] mt-0.5">{p}</p>)}
                  </div>
                ))}
              </div>
            </Section>

            <section className="mt-6 pt-3 border-t border-[#d1d5db] text-[11px] text-[#374151]">
              <p>I confirm this report was produced from our company&apos;s HammerTrack account and has not been altered.</p>
              <div className="grid grid-cols-3 gap-6 mt-8">
                <p className="border-t border-[#111827] pt-1">Name and title</p>
                <p className="border-t border-[#111827] pt-1">Signature</p>
                <p className="border-t border-[#111827] pt-1">Date</p>
              </div>
            </section>
          </article>
        )}
      </div>
    </div>
  )
}

const PRINT_CSS = `
@media print {
  @page { size: letter; margin: 0.45in; }
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body * { visibility: hidden !important; }
  #insurer-report, #insurer-report * { visibility: visible !important; }
  #insurer-report { position: absolute !important; left: 0; top: 0; width: 100%; max-width: none; box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
  .ht-noprint { display: none !important; }
  * { overflow: visible !important; }
  .h-full { height: auto !important; }
  #insurer-report section { break-inside: avoid-page; }
}
`

function rateText(rate: number | null, n: number, severe = 0): string {
  if (rate == null) return 'not measured (accelerometer off)'
  return `${rate} (${n} event${n === 1 ? '' : 's'}${severe ? `, ${severe} severe` : ''})`
}

function scoreText(s: SafetyScore): string {
  return s.credible && s.score != null ? `${s.score} ${s.grade}` : '—'
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-[13px] font-bold uppercase tracking-wide border-b border-[#d1d5db] pb-1 mb-2">{n}. {title}</h2>
      {children}
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded border border-[#d1d5db] p-2">
      <p className="text-[10px] uppercase tracking-wide text-[#6b7280]">{label}</p>
      <p className="text-[16px] font-bold capitalize">{value}</p>
      {sub && <p className="text-[10.5px] text-[#6b7280]">{sub}</p>}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-b border-[#e5e7eb]">
      <td className="py-1 pr-3 text-[#374151] align-top">{k}</td>
      <td className="py-1 font-medium align-top">{v}</td>
    </tr>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`py-1 px-1.5 text-[10.5px] font-semibold ${right ? 'text-right' : ''}`}>{children}</th>
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return <td className={`py-1 px-1.5 ${right ? 'text-right' : ''} ${mono ? 'font-mono text-[10.5px]' : ''}`}>{children}</td>
}
