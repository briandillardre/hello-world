import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PushPrefs } from '@/components/settings/PushPrefs'
import { loadMyPushPrefs } from '@/lib/db/person-notify'
import { getMyPermissions } from '@/lib/permissions-server'

export const metadata = { title: 'HammerTrack — My phone' }
export const dynamic = 'force-dynamic'

/**
 * My phone — the one settings page with NO view level in front of it.
 *
 * `settings` is an Admin-only level, so a Manager, Foreman or Associate 404s
 * on /settings. Quieting your own phone is not an admin power (docs/
 * NOTIFICATIONS.md: "yourself, always — including an Associate whose role has
 * no other settings at all"), so it lives on its own route, exempted in
 * `featureForPath`, and the navs point everyone without /settings here.
 */
export default async function MyPhonePage() {
  const [mine, perms] = await Promise.all([loadMyPushPrefs(), getMyPermissions()])
  const canSeeSettings = perms.features.includes('settings')
  return (
    <div className="h-full overflow-auto pb-36 md:pb-24">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <h1 className="text-xl font-bold text-ink">My phone</h1>
      </div>
      <div className="p-4 space-y-4 max-w-xl">
        {mine ? (
          // The page heading already says "My phone" — compact drops the
          // card's own duplicate title, keeps everything else identical.
          <section className="rounded-xl border border-navy-800 bg-navy-900 p-4">
            <p className="text-[11.5px] text-faint">
              What buzzes on <span className="text-muted">your</span> device, separate from what
              the company sends. A summary still has to be switched on for the company before
              anyone gets it.
            </p>
            <PushPrefs userId={mine.userId} initial={mine.prefs} whose="mine" changedBy={mine.changedBy} compact />
          </section>
        ) : (
          <p className="rounded-xl border border-navy-800 bg-navy-900 p-4 text-sm text-faint">
            Sign in again to change your notifications.
          </p>
        )}
        {canSeeSettings && (
          <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> All settings
          </Link>
        )}
      </div>
    </div>
  )
}
