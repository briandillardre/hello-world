import { NextRequest, NextResponse } from 'next/server'
import { resolveDigestPrefs, localNow, gatherWeeklyFacts, fridayEmailHtml, fridaySms, sundayEmailHtml } from '@/lib/weekly-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Weekly digests — runs HOURLY on Friday and Sunday (UTC cron '0 * * * 5,0';
 * Sat 6 is included so late US-timezone Friday hours still fire after UTC
 * midnight). Each company's prefs pick the local day/hour/channel:
 *   Friday recap  — email and/or SMS, default 4 PM local
 *   Sunday ahead  — email, default 6 PM local
 * The last-sent stamps make sends idempotent within a week.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  const { data: companies, error } = await db.from('companies')
    .select('id, name, alert_email, alert_phone, digest_prefs, last_friday_digest_at, last_sunday_digest_at')
    .limit(100)
  if (error) return NextResponse.json({ ok: true, skipped: 'pre-047 DB', detail: error.message })

  const FRESH = 5 * 86_400_000 // a stamp younger than 5 days = already sent this week
  const results: { company: string; sent: string[] }[] = []

  for (const co of companies ?? []) {
    const prefs = resolveDigestPrefs(co.digest_prefs)
    const { day, hour } = localNow(prefs.tz)
    const sent: string[] = []

    const wantFriday = prefs.friday.enabled && day === 5 && hour === prefs.friday.hour &&
      (!co.last_friday_digest_at || Date.now() - Date.parse(co.last_friday_digest_at) > FRESH)
    const wantSunday = prefs.sunday.enabled && day === 0 && hour === prefs.sunday.hour &&
      (!co.last_sunday_digest_at || Date.now() - Date.parse(co.last_sunday_digest_at) > FRESH)
    if (!wantFriday && !wantSunday) continue

    const facts = await gatherWeeklyFacts(db, co.id, co.name ?? 'Your company', prefs.tz)

    if (wantFriday) {
      let delivered = false
      if (prefs.friday.email && co.alert_email) {
        const { sendEmail } = await import('@/lib/email')
        const r = await sendEmail(co.alert_email, `${facts.company} — Friday wrap-up`, fridayEmailHtml(facts))
        delivered = delivered || r.ok
      }
      if (prefs.friday.sms && co.alert_phone) {
        const { sendAlertSms } = await import('@/lib/notify')
        const r = await sendAlertSms(co.alert_phone, fridaySms(facts))
        delivered = delivered || r.ok
      }
      // Stamp even when nothing is configured — otherwise the cron re-tries
      // this company every hour all evening for a send that can never work.
      await db.from('companies').update({ last_friday_digest_at: new Date().toISOString() }).eq('id', co.id)
      sent.push(delivered ? 'friday' : 'friday (no channel configured)')
    }

    if (wantSunday) {
      let delivered = false
      if (co.alert_email) {
        const { sendEmail } = await import('@/lib/email')
        const r = await sendEmail(co.alert_email, `${facts.company} — the week ahead`, sundayEmailHtml(facts))
        delivered = r.ok
      }
      await db.from('companies').update({ last_sunday_digest_at: new Date().toISOString() }).eq('id', co.id)
      sent.push(delivered ? 'sunday' : 'sunday (no email configured)')
    }

    results.push({ company: co.name ?? co.id, sent })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), results })
}
