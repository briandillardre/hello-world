import { cookies } from 'next/headers'
import Link from 'next/link'
import { QrCode } from 'lucide-react'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/zones'
import { getRecentFieldDays } from '@/lib/db/fieldops'
import { getAssetsWithLocations, getLocationHistory } from '@/lib/db/assets'
import { pairOperators, type PairSegment } from '@/lib/pairing'
import { getPairDecisions } from '@/lib/actions/pairs'
import { DEFAULT_TZ } from '@/lib/dates'
import { LogsFeed } from '@/components/field/LogsFeed'

export const metadata = { title: 'HammerTrack — Daily logs' }

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** The office's morning read: daily logs by day → project, plus the hours table. */
export default async function LogsPage() {
  const companyId = await getCurrentCompanyId()
  const [{ entries, logs, available }, geofences, assets] = await Promise.all([
    getRecentFieldDays(companyId, 7),
    getGeofences(companyId),
    getAssetsWithLocations(companyId),
  ])
  // Who-ran-what (beta): correlate phone tracks with machine tracks. Empty
  // until the crew's phones are tracking — the section hides itself.
  let pairs: PairSegment[] = []
  if (available && assets.some((a) => a.type === 'personnel')) {
    const history = await getLocationHistory(companyId, new Date(Date.now() - 7 * 86_400_000).toISOString(), 30_000)
    if (history?.length) pairs = pairOperators(history, assets)
  }
  const pairDecisions = pairs.length ? await getPairDecisions(7) : []
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)
  const zoneNames: Record<string, string> = {}
  for (const g of geofences) zoneNames[g.id] = g.name

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20"><div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display font-bold text-xl text-ink">Daily logs</h1>
          <p className="text-[12.5px] text-faint">Last 7 days — who was where, what got done, what went wrong.</p>
        </div>
        <Link
          href="/qr"
          className="flex items-center gap-1.5 rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-[12.5px] font-semibold text-muted hover:text-ink hover:border-teal/50 transition flex-none"
        >
          <QrCode className="h-4 w-4 text-teal" /> QR stickers
        </Link>
      </div>

      {!available ? (
        <div className="rounded-xl border border-navy-700 bg-navy-950 p-8 text-center">
          {isMock ? (
            <>
              <p className="text-sm text-muted">
                This is the office&apos;s morning read: every crew day grouped by project — writeups, photos,
                receipts, safety flags in red, and an hours table that shames whoever forgot to clock out.
                Sign in to a live account to see your crew&apos;s logs.
              </p>
              <Link
                href="/register"
                className="inline-block mt-4 rounded-lg bg-amber text-[#1a1100] font-display font-bold px-5 py-2.5 hover:brightness-110 transition"
              >
                Start free →
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted">
              One quick database update turns field ops on — run migration{' '}
              <span className="font-mono text-teal">015_field_ops.sql</span> in the Supabase SQL Editor, then
              have the crew clock in at <span className="font-mono text-teal">/clock</span>.
            </p>
          )}
        </div>
      ) : (
        <LogsFeed entries={entries} logs={logs} zoneNames={zoneNames} tz={tz} pairs={pairs} pairDecisions={pairDecisions} />
      )}
    </div></div>
  )
}
