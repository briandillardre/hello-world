import Link from 'next/link'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { DeleteAccountFlow } from '@/components/settings/DeleteAccountFlow'

export const metadata = { title: 'HammerTrack — Delete account' }

/**
 * Dedicated deletion screen (Brian, Aug 22): the Settings card only links
 * here, and the button below stays disabled until the user types DELETE —
 * an accidental deletion now takes a navigation, a typed word, and a tap.
 */
export default function DeleteAccountPage() {
  return (
    <div className="h-full overflow-auto pb-36 md:pb-24">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3">
        <Link href="/settings" className="p-1 -m-1 text-faint hover:text-ink" aria-label="Back to settings">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-bold text-ink">Delete account</h1>
      </div>

      <div className="p-4 max-w-xl space-y-4">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 flex-none mt-0.5" />
          <div className="text-[13px] text-red-300 leading-relaxed">
            <p className="font-semibold text-red-300">This permanently deletes your company&apos;s account.</p>
            <ul className="mt-2 space-y-1 list-disc pl-4 text-red-300/90">
              <li>All assets, trackers and their full location history</li>
              <li>Zones, geofences, alerts and alert history</li>
              <li>Daily logs, time clock records, receipts and work orders</li>
              <li>Access for every team member — not just you</li>
            </ul>
          </div>
        </div>

        <p className="text-[13px] text-muted leading-relaxed">
          Filing this request signs you out immediately. We complete the deletion within 30 days,
          as described in the <a href="/privacy" className="text-amber hover:underline">privacy policy</a>.
          Active subscriptions are canceled — nothing further is billed. This cannot be undone,
          and deleted data cannot be recovered.
        </p>

        <div className="rounded-xl border border-navy-800 bg-navy-900 p-4">
          <DeleteAccountFlow />
        </div>

        <p className="text-xs text-faint">
          Just want to stop billing but keep your data? Manage your subscription from{' '}
          <Link href="/settings" className="text-amber hover:underline">Settings</Link> instead.
        </p>
      </div>
    </div>
  )
}
