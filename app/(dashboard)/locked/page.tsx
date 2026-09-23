import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Lock, Map, ArrowRight } from 'lucide-react'
import { getMyPermissions } from '@/lib/permissions-server'
import { featureLabel, firstOpenHref, isProspect, PATH_LABELS, PROSPECT_NEVER, PROSPECT_HIDDEN, FEATURE_KEYS, type FeatureKey } from '@/lib/permissions'

export const metadata = { title: 'HammerTrack — Not in your preview' }
export const dynamic = 'force-dynamic'

/**
 * Where a Prospective Client lands on a page that is not theirs (Brian, Sep
 * 23: "they should see what I see — command center, all buttons, but the
 * ones they don't have access to should show some 'sorry, you do not have
 * access to this'"). Every other role never gets here: a page outside their
 * view levels is absent from the navs and 404s (the Sep 11 rule), and this
 * page sends anyone else straight back to the map. The people and money
 * pages (PROSPECT_HIDDEN) are a 404 for a prospect like for everyone else,
 * so they never land here either.
 */
export default async function LockedPage({ searchParams }: { searchParams: { f?: string; p?: string } }) {
  const perms = await getMyPermissions()
  const key = (FEATURE_KEYS as string[]).includes(searchParams.f ?? '') ? (searchParams.f as FeatureKey) : null
  // Home = the first page that IS open for them (the map, unless the owner
  // switched it off — a "Back to the map" that lands on another lock is no
  // door at all). Nothing open = the help pages, which need no level.
  const home = firstOpenHref(perms.features) ?? '/help'
  if (!isProspect(perms) || !key || perms.features.includes(key) || PROSPECT_HIDDEN.includes(key)) redirect(home)
  // `p` names the page that was tapped when its label differs from the
  // feature's (Time cards → clock, Photos → logs); validated by allow-list.
  const label = (searchParams.p && PATH_LABELS[searchParams.p]) || featureLabel(key) || 'This page'
  const never = PROSPECT_NEVER.includes(key)
  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="max-w-xl mx-auto px-4 py-10">
        <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6">
          <span className="grid place-items-center w-11 h-11 rounded-xl bg-amber/15 border border-amber/30 mb-4">
            <Lock className="h-5 w-5 text-amber" />
          </span>
          <h1 className="font-display font-bold text-xl text-ink">Sorry — you don’t have access to this</h1>
          <p className="mt-2 text-[14px] text-muted leading-snug">
            {never ? (
              <><span className="text-ink font-semibold">{label}</span> isn’t part of a Prospective Client login — it’s the crew’s and the office’s side of the app.</>
            ) : (
              <><span className="text-ink font-semibold">{label}</span> isn’t switched on for your Prospective Client login.</>
            )}
          </p>
          <p className="mt-3 text-[12.5px] text-faint leading-snug">
            You’re looking at a live HammerTrack account that was shared with you to look around. The owner who invited you decides what’s open — ask them if you’d like to see more.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
            <Link href={home} className="inline-flex items-center gap-1.5 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-[13px] px-3.5 py-2 shadow-glow-amber hover:brightness-110 transition">
              <Map className="h-4 w-4" /> {home === '/map' ? 'Back to the map' : 'Back to the app'}
            </Link>
            <Link href="/pricing" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-teal hover:underline">
              Want this for your own fleet? See pricing <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
