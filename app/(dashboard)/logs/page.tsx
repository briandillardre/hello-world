import { cookies } from 'next/headers'
import Link from 'next/link'
import { QrCode } from 'lucide-react'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/geofences'
import { getRecentFieldDays } from '@/lib/db/fieldops'
import { DEFAULT_TZ } from '@/lib/dates'
import { LogsFeed } from '@/components/field/LogsFeed'

export const dynamic = 'force-dynamic'

/** The office's morning read: daily logs by day → project, plus the hours table. */
export default async function LogsPage() {
  const companyId = await getCurrentCompanyId()
  const [{ entries, logs, available }, geofences] = await Promise.all([
    getRecentFieldDays(companyId, 7),
    getGeofences(companyId),
  ])
  const tz = decodeURIComponent(cookies().get('ht_tz')?.value ?? DEFAULT_TZ)
  const zoneNames: Record<string, string> = {}
  for (const g of geofences) zoneNames[g.id] = g.name

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
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
          <p className="text-sm text-muted">
            Field ops isn&apos;t set up yet — run migration <span className="font-mono text-teal">015_field_ops.sql</span> in the
            Supabase SQL Editor, then have the crew clock in at <span className="font-mono text-teal">/clock</span>.
          </p>
        </div>
      ) : (
        <LogsFeed entries={entries} logs={logs} zoneNames={zoneNames} tz={tz} />
      )}
    </div>
  )
}
