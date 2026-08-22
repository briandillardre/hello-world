import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'

/**
 * In-app account deletion entry point — Apple guideline 5.1.1(v) requires it
 * to live inside the app. The Settings card is only a warning + a link: the
 * actual deletion flow lives on its own screen behind a typed confirmation
 * (Brian, Aug 22 — "I don't want anybody deleting their account by accident").
 */
export function DeleteAccountCard() {
  return (
    <section className="bg-navy-900 rounded-xl border border-red-500/25 overflow-hidden">
      <div className="flex items-start gap-2.5 bg-red-500/10 border-b border-red-500/25 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-red-400 flex-none mt-0.5" />
        <p className="text-[12.5px] text-red-300 leading-snug">
          <span className="font-semibold">Danger zone.</span> Deleting your account permanently
          erases your company&apos;s assets, tracking history, zones, logs and receipts for every
          team member. This cannot be undone.
        </p>
      </div>
      <div className="p-4">
        <h2 className="font-display font-bold text-ink text-sm">Delete my account</h2>
        <p className="text-[12.5px] text-faint mt-1">
          Files a deletion request for your account and its data. We complete deletion within
          30 days, as described in the <a href="/privacy" className="text-amber hover:underline">privacy policy</a>.
        </p>
        <Link
          href="/settings/delete-account"
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"
        >
          Continue to account deletion <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  )
}
