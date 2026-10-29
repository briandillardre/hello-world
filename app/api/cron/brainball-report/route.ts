import { NextRequest, NextResponse } from 'next/server'
import { buildDailyReports, renderReportEmail } from '@/lib/game/report'
import { emailConfigured, sendEmail } from '@/lib/email'
import type { KidProfile } from '@/lib/game/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Brain Ball daily parent report — hourly cron, but each parent account gets
 * AT MOST one email per local day, and only when a (non-tester) kid actually
 * answered questions since the last report. Benchmarks per skill, AMIRA-style
 * (Brian, Oct 29). The send stamp is CLAIMED compare-and-set before the email
 * goes out, so a crashed run or a concurrent runner can't double-send.
 */

// family default — make this a per-account pref if anyone outside ET ever asks
const REPORT_TZ = 'America/New_York'
/** emails go out on the first run at/after 7 PM local (after the day's play) */
const SEND_HOUR = 19

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const localHour = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TZ, hour: 'numeric', hour12: false }).format(d)) % 24

export async function GET(req: NextRequest) {
  // fail closed — an unauthenticated caller must never be able to trigger mail
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })
  if (!emailConfigured()) return NextResponse.json({ skipped: 'email not configured' })

  const force = new URL(req.url).searchParams.get('force') === '1' // testing: skip the clock, never the opt-out
  const now = new Date()
  if (!force && localHour(now) < SEND_HOUR) return NextResponse.json({ skipped: 'before send hour' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: rows, error } = await db
    .from('brainball_profiles')
    .select('user_id, payload, last_report_at, report_optout')
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const today = localDay(now)
  const results: Array<{ user: string; kids?: string[]; sent?: boolean; error?: string }> = []
  for (const row of rows ?? []) {
    const tag = String(row.user_id).slice(0, 8)
    try {
      if (row.report_optout) continue
      const lastAt = row.last_report_at ? new Date(row.last_report_at).getTime() : 0
      if (lastAt > 0 && localDay(new Date(lastAt)) === today && !force) continue // max 1/day

      const profiles = ((row.payload as { profiles?: KidProfile[] } | null)?.profiles ?? []).filter(Boolean)
      if (profiles.length === 0) continue
      // window: everything since the last report (late-evening play lands in the
      // NEXT day's email instead of vanishing), clamped to 48h; first ever
      // report covers the last 24h
      const sinceMs = lastAt > 0 ? Math.max(lastAt, now.getTime() - 48 * 3600 * 1000) : now.getTime() - 24 * 3600 * 1000
      const reports = buildDailyReports(profiles, sinceMs, now)
      if (reports.length === 0) continue // nobody played — no email

      const { data: user } = await db.auth.admin.getUserById(row.user_id)
      const email = user?.user?.email
      if (!email) continue

      // claim BEFORE sending (compare-and-set on the previous stamp) — a run
      // crashing after the send, or two overlapping runners, must not double-send
      let claim = db.from('brainball_profiles').update({ last_report_at: now.toISOString() }).eq('user_id', row.user_id)
      claim = row.last_report_at ? claim.eq('last_report_at', row.last_report_at) : claim.is('last_report_at', null)
      const { data: claimed } = await claim.select('user_id')
      if (!claimed || claimed.length === 0) continue // another runner got it

      const { subject, html } = renderReportEmail(reports, now, REPORT_TZ)
      const sent = await sendEmail(email, subject, html)
      results.push({ user: tag, kids: reports.map((r) => r.name), sent: sent.ok, ...(sent.ok ? {} : { error: sent.error }) })
    } catch (err) {
      console.error('brainball report failed for', tag, err)
      results.push({ user: tag, error: 'failed' })
    }
  }
  return NextResponse.json({ checked: rows?.length ?? 0, results })
}
