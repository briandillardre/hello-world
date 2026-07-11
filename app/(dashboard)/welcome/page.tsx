import Link from 'next/link'
import { Check, Plus, Hexagon, UserPlus, Radio, ArrowRight } from 'lucide-react'
import { getAssetsWithLocations } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getCurrentCompany } from '@/lib/db/company'
import { getTeam } from '@/lib/db/team'

export default async function WelcomePage() {
  const company = await getCurrentCompany()
  const [assets, geofences, team] = await Promise.all([
    getAssetsWithLocations(company.id),
    getGeofences(company.id),
    getTeam(),
  ])

  const hasAsset = assets.length > 0
  const reporting = assets.some((a) => a.location)
  const hasZone = geofences.length > 0
  const hasTeam = team.members.length > 1

  const steps = [
    { key: 'asset', done: hasAsset, icon: Plus, title: 'Add your first asset', body: 'A truck, machine, or Bluetooth-tagged tool — with its tracker ID.', href: '/assets', cta: 'Add an asset' },
    { key: 'tracker', done: reporting, icon: Radio, title: 'Plug in a tracker', body: 'The OBD or GPS unit goes live the moment it reports — your asset appears on the map.', href: '/settings', cta: 'Integration guide' },
    { key: 'zone', done: hasZone, icon: Hexagon, title: 'Draw a job-site zone', body: 'Outline your yard or a jobsite so theft alerts and cost-per-site kick in.', href: '/map', cta: 'Open the map' },
    { key: 'team', done: hasTeam, icon: UserPlus, title: 'Invite your crew', body: 'Add a foreman or office admin — set exactly what each person can do.', href: '/team', cta: 'Invite teammates' },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)
  const pct = Math.round((doneCount / steps.length) * 100)

  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-20">
      <div className="max-w-2xl mx-auto p-5 sm:p-8">
        <div className="text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-teal">Welcome to HammerTrack</p>
          <h1 className="font-display font-black text-[1.9rem] sm:text-[2.3rem] leading-tight mt-2 text-ink text-balance">
            {doneCount === steps.length ? "You're all set." : `Let's get ${company.name} live.`}
          </h1>
          <p className="text-muted mt-2 text-[15px]">
            {doneCount === steps.length
              ? 'Your fleet is set up. Everything below is done — head to the map.'
              : 'Four quick steps. You can do them in any order, and come back anytime.'}
          </p>
        </div>

        {/* progress */}
        <div className="mt-6 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-navy-800 overflow-hidden">
            <div className="h-full bg-amber rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-xs text-faint tabular-nums">{doneCount}/{steps.length}</span>
        </div>

        <div className="mt-6 space-y-3">
          {steps.map((s) => {
            const Icon = s.icon
            return (
              <div key={s.key} className={`rounded-xl border p-4 flex items-start gap-4 transition-colors ${s.done ? 'border-navy-800 bg-navy-900/50' : 'border-navy-700 bg-navy-900'}`}>
                <div className={`w-10 h-10 rounded-full grid place-items-center flex-none ${s.done ? 'bg-[#34d399]/15 text-[#34d399]' : 'bg-amber/15 text-amber'}`}>
                  {s.done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`font-display font-bold text-[15px] ${s.done ? 'text-muted line-through decoration-navy-700' : 'text-ink'}`}>{s.title}</h3>
                  <p className="text-[13px] text-faint mt-0.5">{s.body}</p>
                </div>
                {!s.done && (
                  <Link href={s.href} className="flex-none self-center text-sm font-semibold text-amber hover:underline whitespace-nowrap">
                    {s.cta} →
                  </Link>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-7 flex flex-col sm:flex-row gap-3">
          {next ? (
            <Link href={next.href} className="flex-1 text-center font-display font-bold rounded-xl py-3 bg-amber text-[#1a1100] hover:bg-amber-600 transition-colors inline-flex items-center justify-center gap-2">
              {next.cta} <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <Link href="/map" className="flex-1 text-center font-display font-bold rounded-xl py-3 bg-amber text-[#1a1100] hover:bg-amber-600 transition-colors">
              Go to your live map
            </Link>
          )}
          <Link href="/map" className="flex-1 text-center font-display font-bold rounded-xl py-3 border border-navy-700 text-muted hover:bg-navy-800 hover:text-ink transition-colors">
            Skip to the map
          </Link>
        </div>
      </div>
    </div>
  )
}
