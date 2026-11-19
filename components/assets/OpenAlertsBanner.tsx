import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { getAlertEvents } from '@/lib/db/alerts'
import { isZoneLogEvent } from '@/lib/alerts-engine'

const WORDS: Record<string, string> = {
  after_hours_movement: 'THEFT ALERT · moved after hours', left_site: 'Left the site', idle: 'Idle', speeding: 'Speeding',
  power_lost: 'Lost truck power', fuel_critical: 'Fuel critical', battery_critical: 'Battery critical', oem_fault: 'Engine fault',
}
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

/**
 * The machine's open alerts at the top of its page (owner review, Nov 19: a
 * Link-Belt with a theft alert 9 minutes old read only "Stationary" here).
 */
export async function OpenAlertsBanner({ companyId, assetId, canRecover }: { companyId: string; assetId: string; canRecover: boolean }) {
  const all = await getAlertEvents(companyId).catch(() => [])
  const open = all.filter((e) => e.asset_id === assetId && !e.acknowledged_at && !isZoneLogEvent(e))
    .sort((a, b) => Date.parse(b.triggered_at) - Date.parse(a.triggered_at))
  if (!open.length) return null
  const newest = open[0]
  const what = WORDS[newest.kind ?? ''] ?? WORDS[newest.rule?.trigger ?? ''] ?? 'Alert'
  const theft = ['after_hours_movement', 'left_site'].includes(newest.rule?.trigger ?? '')
  return (
    <div className="rounded-xl border border-red-400/50 bg-red-950/40 p-3 text-[13px]">
      <p className="flex items-center gap-2 font-semibold text-red-200">
        <AlertTriangle className="h-4 w-4 flex-none" /> {what} · {ago(newest.triggered_at)}{open.length > 1 ? ` · ${open.length} open alerts` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href="/alerts" className="inline-flex min-h-10 items-center rounded-xl border border-red-400/40 px-3 text-red-100 hover:bg-red-900/40">Handle on Alerts</Link>
        {theft && canRecover && (
          <Link href={`?recovery=start&alert=${encodeURIComponent(newest.id)}`} className="inline-flex min-h-10 items-center rounded-xl bg-red-500 px-3 font-semibold text-white hover:bg-red-600">Start recovery</Link>
        )}
      </div>
    </div>
  )
}
