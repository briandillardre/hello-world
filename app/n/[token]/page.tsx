import type { Metadata } from 'next'
import { verifyNotifyToken } from '@/lib/notify-token'
import { resolveDigestPrefs } from '@/lib/weekly-digest'
import { NotifyPrefsForm } from '@/components/settings/NotifyPrefsForm'
import { Logo } from '@/components/brand/Logo'
import { BellOff } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Notification settings · HammerTrack',
  robots: { index: false, follow: false },
}

/**
 * "Turn these off" — the page every digest email and text links to
 * (Brian, Sep 11). No login: the signed token in the URL is the grant, and
 * it covers exactly one company's digest_prefs and nothing else.
 *
 * Deliberately reachable with a thumb from a text message. Big switches, one
 * button that silences everything, and a link into the app for anyone who
 * wants the rest of Settings.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-navy-950 text-ink px-4 py-10">
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div className="flex justify-center"><Logo size={26} href={null} /></div>
        {children}
      </div>
    </div>
  )
}

export default async function NotifyPrefsPage({ params }: { params: { token: string } }) {
  const payload = verifyNotifyToken(params.token)
  if (!payload) {
    return (
      <Shell>
        <div className="rounded-xl border border-navy-800 bg-navy-900 p-6 text-center space-y-3">
          <BellOff className="h-7 w-7 text-faint mx-auto" />
          <h1 className="font-display font-bold text-lg">This link has expired</h1>
          <p className="text-sm text-muted">
            Notification links stop working after 180 days. Sign in and open
            <span className="text-ink font-medium"> Settings → Notifications</span> to change them.
          </p>
          <a href="/settings" className="inline-block rounded-lg bg-amber px-4 py-2 text-sm font-bold text-navy-950">
            Open settings
          </a>
        </div>
      </Shell>
    )
  }

  // A wobbly database must not 500 the page someone opened to make us stop
  // emailing them. Worst case they get the defaults and a working save.
  let data: { name?: string | null; digest_prefs?: unknown } | null = null
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const r = await createServiceClient()
      .from('companies').select('name, digest_prefs').eq('id', payload.companyId).maybeSingle()
    data = r.data
  } catch (err) {
    console.error('notify prefs page load failed', err)
  }

  return (
    <Shell>
      <div className="text-center space-y-1">
        <h1 className="font-display font-bold text-xl">Notification settings</h1>
        <p className="text-sm text-muted">
          {data?.name ? `Summaries for ${data.name}.` : 'Your summaries.'} Changes save as you make them.
        </p>
      </div>
      <NotifyPrefsForm token={params.token} initial={resolveDigestPrefs(data?.digest_prefs)} />
      <p className="text-center text-[11.5px] text-faint">
        Theft and after-hours alerts are not summaries and stay on — turn those off in
        <span className="text-muted"> Settings → Alerts</span> if you need to.
      </p>
      <p className="text-center text-xs">
        <a href="/settings" className="text-teal underline">Open the app for all settings →</a>
      </p>
    </Shell>
  )
}
