import { NextRequest, NextResponse } from 'next/server'
import { resolveDigestPrefs, localNow } from '@/lib/weekly-digest'
import { gatherBriefingFacts, briefingEmailHtml, briefingSms, briefingPush } from '@/lib/briefing'
import { resolvePersonNotify, notifyRole } from '@/lib/person-notify'

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
    // One-tap way out in every email and text (Brian, Sep 11).
    const { notifyPrefsUrl } = await import('@/lib/notify-token')
    const manageUrl = notifyPrefsUrl(co.id)

    let delivered = false
    if (b.email && co.alert_email) {
      const { sendEmail } = await import('@/lib/email')
      const r = await sendEmail(co.alert_email, `${facts.company} — morning briefing · ${facts.dateLabel}`, briefingEmailHtml(facts, manageUrl))
      delivered = delivered || r.ok
    }
    if (b.sms && co.alert_phone) {
      const { sendAlertSms } = await import('@/lib/notify')
      const r = await sendAlertSms(co.alert_phone, briefingSms(facts, manageUrl))
      delivered = delivered || r.ok
    }
    // Each manager gets it too — their own email and a push to their phone,
    // behind their own "Morning briefing" switch (Nov 6: the briefing went
    // only to the office inbox, so JT and Nate never saw it). Email skips
    // the address the company copy already went to.
    let people = 0
    try {
      const { data: profs } = await db.from('profiles').select('id, company_id, role, email, notify_prefs').eq('company_id', co.id)
      const push = briefingPush(facts)
      const { sendPushToUser } = await import('@/lib/push')
      const { sendEmail } = await import('@/lib/email')
      const sentTo = new Set([(b.email && co.alert_email ? String(co.alert_email) : '').toLowerCase()])
      for (const p of profs ?? []) {
        const role = notifyRole(p.id as string, co.id, p.role as string | null)
        // The email carries yesterday's site $ — managers and up only.
        if (role !== 'admin' && role !== 'manager') continue
        if (!resolvePersonNotify(p.notify_prefs, role).briefing) continue
        try { await sendPushToUser(co.id, p.id as string, { title: push.title, body: push.body, url: '/assets' }, { strict: true, kind: 'briefing' }) } catch { /* best-effort */ }
        const em = String(p.email ?? '').toLowerCase()
        if (em && !sentTo.has(em)) {
          sentTo.add(em)
          const r = await sendEmail(em, `${facts.company} — morning briefing · ${facts.dateLabel}`, briefingEmailHtml(facts, manageUrl))
          delivered = delivered || r.ok
        }
        people++
      }
    } catch (err) { console.error('briefing per-person delivery failed', err) }
    // Stamp even when no channel is configured — otherwise this retries
    // hourly all morning for a send that can never work.
    await db.from('companies').update({ last_briefing_at: new Date().toISOString() }).eq('id', co.id)
    results.push({ company: co.name ?? co.id, sent: delivered ? `briefing (+${people} people)` : 'briefing (no channel configured)' })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), results })
}
