import type { Metadata } from 'next'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { COMPONENTS, current, dailyBars, uptime, type Check } from '@/lib/beta/status'

export const metadata: Metadata = {
  title: 'HammerTrack — Status',
  description: 'Is HammerTrack up? The app, tracker data and Ask AI, checked every hour.',
}
export const revalidate = 300

const DAYS = 90

/**
 * The public status page (migration 162). The health cron writes one check an
 * hour; this shows up / down per component per day. Nothing about any
 * company — only whether the service answered. A day with no check shows as
 * "no data", never as up.
 */
async function load(): Promise<Check[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url || url === 'https://your-project.supabase.co' || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const { createServiceClient } = await import('@/lib/supabase-server')
    const { data, error } = await createServiceClient().from('status_checks').select('checked_at, db_ok, ingest_ok, ai_ok')
      .gte('checked_at', new Date(Date.now() - DAYS * 86_400_000).toISOString()).order('checked_at', { ascending: false }).limit(3000)
    if (error) return null
    return (data ?? []).map((r) => ({ at: String(r.checked_at), db: !!r.db_ok, ingest: r.ingest_ok as boolean | null, ai: r.ai_ok as boolean | null }))
  } catch {
    return null
  }
}

const COLOR = { up: 'bg-teal', partial: 'bg-amber', down: 'bg-red-500', none: 'bg-navy-700' } as const

export default async function StatusPage() {
  const checks = await load()
  const now = Date.now()
  const today = new Date(now).toISOString().slice(0, 10)
  const bars = checks ? dailyBars(checks, DAYS, today) : null
  const cur = checks ? current(checks, now) : null
  const allUp = cur && Object.values(cur).every((v) => v === 'up')
  const anyDown = cur && Object.values(cur).some((v) => v === 'down')
  return (
    <div className="min-h-screen bg-navy-950 text-ink">
      <SiteNav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 pb-20 space-y-6">
        <div>
          <h1 className="font-display font-black text-[2rem]">HammerTrack status</h1>
          <p className="text-muted mt-1">Checked every hour. Times in UTC.</p>
        </div>
        <div className={`rounded-xl border px-4 py-3 font-semibold ${!cur ? 'border-navy-700 text-muted' : allUp ? 'border-teal/40 bg-teal/5 text-teal' : anyDown ? 'border-red-400/40 bg-red-950/30 text-red-200' : 'border-amber/40 bg-amber/5 text-amber'}`}>
          {!cur ? 'No status data yet — the hourly checks start with this release.' : allUp ? 'All systems answering' : anyDown ? 'Something is down — see below' : 'Some checks haven’t reported in the last two hours'}
        </div>
        {COMPONENTS.map((c) => {
          const b = bars?.[c.key] ?? []
          const u = checks ? uptime(checks, c.key) : null
          const state = cur?.[c.key] ?? 'unknown'
          return (
            <section key={c.key} className="rounded-xl border border-navy-800 bg-navy-900/60 p-4 space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-[16px]">{c.label}</h2>
                  <p className="text-faint text-[12.5px]">{c.hint}</p>
                </div>
                <p className={`text-[13px] ${state === 'up' ? 'text-teal' : state === 'down' ? 'text-red-300' : 'text-muted'}`}>
                  {state === 'up' ? 'Up' : state === 'down' ? 'Down' : 'No recent check'}{u !== null ? ` · ${u}% over ${DAYS} days` : ''}
                </p>
              </div>
              <div className="flex gap-[2px] h-8 items-stretch" role="img" aria-label={`${c.label}: ${DAYS} days of daily status`}>
                {b.map((d) => <div key={d.day} title={`${d.day}: ${d.state === 'none' ? 'no data' : `${d.up}/${d.total} checks up`}`} className={`flex-1 min-w-0 rounded-[2px] ${COLOR[d.state]}`} />)}
              </div>
              <div className="flex justify-between text-faint text-[11px]"><span>{DAYS} days ago</span><span>Today</span></div>
            </section>
          )
        })}
        <div className="flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-teal" /> Up all day</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber" /> Down part of the day</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-red-500" /> Down</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-navy-700" /> No data</span>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
