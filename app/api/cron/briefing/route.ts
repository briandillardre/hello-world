import { NextRequest, NextResponse } from 'next/server'
import { resolveDigestPrefs, localNow } from '@/lib/weekly-digest'
import { loadBriefing, shapeBriefing, OFFICE_AUDIENCE, briefingEmailHtml, briefingSms, briefingPush, type BriefingFacts } from '@/lib/briefing'
import { resolvePersonNotify, notifyRole } from '@/lib/person-notify'
import { resolvePermissions, canSeeAsset, rankOf, type RolePolicy } from '@/lib/permissions'
import { claimSend } from '@/lib/digest-delivery'
import { BRAND_URL } from '@/lib/brand'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Daily site briefing — runs HOURLY; each company's prefs pick the local
 * send hour (default 6 AM), weekdays-only by default. The last_briefing_at
 * stamp (054) makes sends idempotent within a day. Pre-054 databases skip
 * cleanly (the select errors → skipped).
 *
 * Who gets what (sec-check, Nov 7):
 *   • the company's alert inbox / phone — the owner's channel — gets the
 *     office copy (everything) with the company's "turn these off" link;
 *   • each Admin and Manager with their Morning briefing switch on gets a copy
 *     SHAPED FOR THEM: nothing above their rank on the visibility ladder (111),
 *     dollars only with the costs view level, and a link to their own
 *     switches (/settings/phone) — never the company-wide token, which can
 *     silence every summary for the whole company and is an Admin-only write.
 */
export async function GET(req: NextRequest) {
  // FAIL CLOSED: this run emails every Admin and Manager of every company.
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ ok: true, skipped: 'demo mode' })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  const { data: companies, error } = await db.from('companies')
    .select('id, name, alert_email, alert_phone, digest_prefs, last_briefing_at, role_policy')
    .limit(100)
  if (error) return NextResponse.json({ ok: true, skipped: 'pre-054 DB' })

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
    // Claim BEFORE sending (compare-and-set): two overlapping runs in the
    // send hour can't both mail every manager.
    if (!(await claimSend(db, 'last_briefing_at', co.id, (co.last_briefing_at as string | null) ?? null))) continue

    const name = (co.name as string | null) ?? 'Your company'
    const raw = await loadBriefing(db, co.id, prefs.tz)
    const office = await shapeBriefing(raw, name, OFFICE_AUDIENCE)
    // One-tap way out in every office email and text (Brian, Sep 11).
    const { notifyPrefsUrl } = await import('@/lib/notify-token')
    const manageUrl = notifyPrefsUrl(co.id)

    let delivered = false
    if (b.email && co.alert_email) {
      const { sendEmail } = await import('@/lib/email')
      const r = await sendEmail(co.alert_email, `${office.company} — morning briefing · ${office.dateLabel}`, briefingEmailHtml(office, manageUrl))
      delivered = delivered || r.ok
    }
    if (b.sms && co.alert_phone) {
      const { sendAlertSms } = await import('@/lib/notify')
      const r = await sendAlertSms(co.alert_phone, briefingSms(office, manageUrl))
      delivered = delivered || r.ok
    }
    // Each manager gets it too — their own email and a push to their phone,
    // behind their own "Morning briefing" switch (Nov 6: the briefing went
    // only to the office inbox, so the managers never saw it). Email skips
    // the address the office copy already went to, and follows the company's
    // own briefing email switch.
    let people = 0
    try {
      const { data: profs } = await db.from('profiles')
        .select('id, company_id, role, email, notify_prefs, can_view_costs, can_manage_billing, can_manage_team')
        .eq('company_id', co.id)
      const { sendPushToUser } = await import('@/lib/push')
      const { sendEmail } = await import('@/lib/email')
      const sentTo = new Set([(b.email && co.alert_email ? String(co.alert_email) : '').toLowerCase()])
      const policy = (co.role_policy ?? null) as RolePolicy | null
      // At most a few distinct views per company (Master · Admin · Manager,
      // with or without dollars) — shape each once.
      const views = new Map<string, Promise<BriefingFacts>>()
      for (const p of profs ?? []) {
        const role = notifyRole(p.id as string, co.id, p.role as string | null)
        if (role !== 'admin' && role !== 'manager') continue
        if (!resolvePersonNotify(p.notify_prefs, role).briefing) continue
        const perms = resolvePermissions(p, p.id === co.id, policy)
        const key = `${rankOf(perms)}:${perms.canViewCosts ? 1 : 0}`
        let view = views.get(key)
        if (!view) {
          view = shapeBriefing(raw, name, { seesAsset: (a) => canSeeAsset(perms, a.metadata, a.type), money: perms.canViewCosts })
          views.set(key, view)
        }
        const facts = await view
        const push = briefingPush(facts)
        try { await sendPushToUser(co.id, p.id as string, { title: push.title, body: push.body, url: '/assets' }, { strict: true, kind: 'briefing' }) } catch { /* best-effort */ }
        const em = String(p.email ?? '').toLowerCase()
        if (b.email && em && !sentTo.has(em)) {
          sentTo.add(em)
          const r = await sendEmail(em, `${facts.company} — morning briefing · ${facts.dateLabel}`, briefingEmailHtml(facts, `${BRAND_URL}/settings/phone`))
          delivered = delivered || r.ok
        }
        people++
      }
    } catch (err) { console.error('briefing per-person delivery failed', err) }
    results.push({ company: co.id as string, sent: delivered ? `briefing (+${people} people)` : 'briefing (no channel configured)' })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), results })
}
