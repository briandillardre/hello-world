import Link from 'next/link'
import { FileStack, ChevronRight, BookOpen } from 'lucide-react'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { getPlanSites } from '@/lib/db/plans'
import { getGeofences } from '@/lib/db/zones'
import { getCurrentCompanyId } from '@/lib/db/company'
import { setKindLabel } from '@/lib/plans/room'
import { StartPlanRoom } from '@/components/plans/StartPlanRoom'

export const metadata = { title: 'HammerTrack — Plans' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const fmtDay = (d: string) => {
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Every site with a plan room, newest activity first (migration 143). One
 * Plans entry opens bids and jobs together; a site's own page has a Plans
 * card that opens the same room.
 */
export default async function Page() {
  const perms = await requireFeature('plans')
  const companyId = await getCurrentCompanyId()
  const [real, zones] = await Promise.all([getRealPermissions(), getGeofences(companyId)])
  // NEW dots are personal: read as the signed-in person (never a preview's target).
  const mine = await getPlanSites(real.userId)
  const withPlans = new Set(mine.map((s) => s.zoneId))
  const startable = zones
    .filter((z) => z.kind !== 'boundary' && z.kind !== 'vendor' && !withPlans.has(z.id))
    .map((z) => ({ id: z.id, name: z.name }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <h1 className="font-display font-bold text-xl text-ink flex items-center gap-2"><FileStack className="h-5 w-5 text-amber" /> Plans</h1>
            <p className="text-[12.5px] text-faint">Every site’s plan sets, sheets and revisions. The newest version of a sheet is always the one that opens.</p>
          </div>
          {perms.canViewCosts && (
            <Link href="/costbook" className="inline-flex items-center gap-1.5 rounded-xl border border-navy-700 px-3 py-2 text-[12.5px] text-muted hover:text-ink">
              <BookOpen className="h-4 w-4" /> Cost book
            </Link>
          )}
        </div>

        {mine.length === 0 ? (
          <div className="rounded-xl border border-navy-800 bg-navy-900 p-5 text-[13px] text-muted space-y-1">
            <p className="text-ink font-semibold">No plan rooms yet</p>
            <p>Pick a site below and add its bid set’s PDF. {isMock && 'Plans need a real company — the demo has none.'}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
            {mine.map((s) => (
              <Link key={s.zoneId} href={`/plans/${s.zoneId}`} className="flex items-center gap-3 px-3 py-3 hover:bg-navy-800/60">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate flex items-center gap-2">
                    {s.name}
                    {s.newCount > 0 && <span className="text-[10.5px] rounded-full bg-amber/15 text-amber px-2 py-px">{s.newCount} new</span>}
                  </p>
                  <p className="text-[11.5px] text-faint">
                    {s.sheets} sheet{s.sheets === 1 ? '' : 's'} · {s.sets} set{s.sets === 1 ? '' : 's'}
                    {s.newest && <> · newest: {s.newest.name} ({setKindLabel(s.newest.kind)}, {fmtDay(s.newest.issuedOn)})</>}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-faint" />
              </Link>
            ))}
          </div>
        )}

        {perms.canEdit && !isMock && startable.length > 0 && <StartPlanRoom sites={startable} />}
      </div>
    </div>
  )
}
