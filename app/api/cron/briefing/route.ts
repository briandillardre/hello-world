import { NextRequest, NextResponse } from 'next/server'
import { resolveDigestPrefs, localNow } from '@/lib/weekly-digest'
import { gatherBriefingFacts, briefingEmailHtml, briefingSms } from '@/lib/briefing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Daily site briefing — runs HOURLY; each company's prefs pick the local
 * send hour (default 6 AM), weekdays-only by default. The last_briefing_at
 * stamp (054) makes sends idempotent within a day. Pre-054 databases skip
 * cleanly (the select errors → skipped).
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
    .select('id, name, alert_email, alert_phone, digest_prefs, last_briefing_at')
    .limit(100)
  if (error) return NextResponse.json({ ok: true, skipped: 'pre-054 DB', detail: error.message })

  const FRESH = 20 * 3_600_000 // stamp younger than 20h = already sent today
  const results: { company: string; sent: string }[] = []

  for (const co of companies ?? []) {
    const prefs = resolveDigestPrefs(co.digest_prefs)
    const b = prefs.briefing
    if (!b.enabled) continue
    const { day, hour } = localNow(prefs.tz)
    if (hour !== b.hour) continue
    if (b.weekdaysOnly && (day === 0 || day === 6)) continue
    if (co.last_briefing_at && Date.now() - Date.parse(co.last_briefing_at) < FRESH) continue

    const facts = await gatherBriefingFacts(db, co.id, co.name ?? 'Your company', prefs.tz)

    let delivered = false
    if (b.email && co.alert_email) {
      const { sendEmail } = await import('@/lib/email')
      const r = await sendEmail(co.alert_email, `${facts.company} — morning briefing · ${facts.dateLabel}`, briefingEmailHtml(facts))
      delivered = delivered || r.ok
    }
    if (b.sms && co.alert_phone) {
      const { sendAlertSms } = await import('@/lib/notify')
      const r = await sendAlertSms(co.alert_phone, briefingSms(facts))
      delivered = delivered || r.ok
    }
    // Stamp even when no channel is configured — otherwise this retries
    // hourly all morning for a send that can never work.
    await db.from('companies').update({ last_briefing_at: new Date().toISOString() }).eq('id', co.id)
    results.push({ company: co.name ?? co.id, sent: delivered ? 'briefing' : 'briefing (no channel configured)' })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), results })
}
