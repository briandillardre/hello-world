import type { SupabaseClient } from '@supabase/supabase-js'
import { BRAND_URL } from './brand'
import { notifyPrefsUrl } from './notify-token'

/**
 * ONE door for every recurring summary (Brian, Sep 11 — two evening digests
 * landed on his phone in the same minute, one of them another company's).
 *
 * What was wrong: /api/cron/digest, /agenda and /nag each looped over EVERY
 * company and POSTed the result to the single global NOTIFY_WEBHOOK_URL —
 * one founder ntfy topic. So the founder's phone got one notification per
 * company per night (the screenshot), every customer's fleet names, crew
 * names and safety notes were pushed to a topic they do not own, and the
 * customer themselves got nothing and had no way to turn any of it off.
 *
 * The rule now:
 *   • A company's summary goes to THAT COMPANY — its registered devices, its
 *     alert email, its alert phone — and only on the channels its own prefs
 *     ask for.
 *   • NOTIFY_WEBHOOK_URL is a founder/dev mirror. It only ever receives the
 *     platform owner's OWN company, and only when we can prove it is theirs.
 *     Fail closed: an unresolvable owner means no webhook, never a guess.
 *   • Every email and text carries the one-tap way out.
 */

export interface DeliveryTarget {
  id: string
  name: string
  alert_email?: string | null
  alert_phone?: string | null
}

export interface DeliveryChannels {
  push?: boolean
  email?: boolean
  sms?: boolean
}

export interface DeliveryResult {
  pushed: number
  emailed: boolean
  texted: boolean
  webhooked: boolean
}

// ── Founder mirror ─────────────────────────────────────────────────────────

/** Cached per lambda: the answer never changes inside one cron run. */
const ownerCompanyCache = new Map<string, boolean>()

/**
 * Is this company the platform owner's own? The Master Admin is the company
 * creator, so `profiles.id === companies.id` (docs/ROLES.md) — resolve that
 * user's email through the admin API and check it against the allow-list.
 *
 * Fails CLOSED on any error or with the allow-list unset: a wrong `true`
 * ships a customer's day to someone else's phone, while a wrong `false`
 * only costs the founder a duplicate they already get by push.
 */
export async function isPlatformOwnerCompany(db: SupabaseClient, companyId: string): Promise<boolean> {
  const hit = ownerCompanyCache.get(companyId)
  if (hit !== undefined) return hit
  let owned = false
  try {
    const listed = (process.env.PLATFORM_OWNER_EMAILS ?? '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (listed.length) {
      const { data, error } = await db.auth.admin.getUserById(companyId)
      const email = data?.user?.email?.toLowerCase() ?? ''
      owned = !error && !!email && !!data?.user?.email_confirmed_at && listed.includes(email)
    }
  } catch {
    owned = false
  }
  ownerCompanyCache.set(companyId, owned)
  return owned
}

/** The founder's ntfy/webhook mirror. Never called for a customer company. */
async function mirrorToWebhook(title: string, text: string, clickPath: string, company: string): Promise<boolean> {
  const url = process.env.NOTIFY_WEBHOOK_URL
  if (!url) return false
  try {
    if (/(^|\/\/|\.)ntfy\./.test(url) || url.includes('ntfy.sh/')) {
      // Header values must be ASCII — an emoji in Title makes fetch THROW.
      const res = await fetch(url, {
        method: 'POST',
        headers: { Title: title, Priority: 'default', Tags: 'clipboard', Click: `${BRAND_URL}${clickPath}` },
        body: text,
        signal: AbortSignal.timeout(10_000),
      })
      return res.ok
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company, digest: text, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch (err) {
    console.error('digest webhook mirror failed', err)
    return false
  }
}

/**
 * Owner-gated mirror for the non-summary paths (real-time alerts, safety
 * reports). Same rule, one call: nothing reaches NOTIFY_WEBHOOK_URL unless
 * the company is provably the platform owner's.
 */
export async function mirrorOwnerWebhook(
  db: SupabaseClient,
  companyId: string,
  title: string,
  text: string,
  clickPath = '/map',
): Promise<boolean> {
  if (!process.env.NOTIFY_WEBHOOK_URL) return false
  if (!(await isPlatformOwnerCompany(db, companyId))) return false
  return mirrorToWebhook(title, text, clickPath, companyId)
}

/**
 * Take a company's send slot for today BEFORE delivering anything.
 *
 * Stamping after the send looked fine until you count the ways a run dies
 * between the two: maxDuration kills the lambda mid-loop, the model call
 * hangs, the UPDATE itself errors. The company is then still un-stamped,
 * still inside dueNow's grace window, and sorts FIRST next hour — so it gets
 * the same summary twice. That is the exact complaint this whole change
 * exists to fix (ship-check P0, Sep 11).
 *
 * Matching on the PREVIOUS value makes it a compare-and-set, so two
 * overlapping runs can never both claim the same company.
 */
export async function claimSend(
  db: SupabaseClient,
  column: 'last_evening_digest_at' | 'last_agenda_at' | 'last_nag_at',
  companyId: string,
  previous: string | null,
): Promise<boolean> {
  const base = db.from('companies').update({ [column]: new Date().toISOString() }).eq('id', companyId)
  const { data, error } = await (previous === null ? base.is(column, null) : base.eq(column, previous)).select('id')
  if (error) { console.error(`claimSend ${column} failed`, error.message); return false }
  return (data?.length ?? 0) > 0
}

// ── Delivery ───────────────────────────────────────────────────────────────

/**
 * Send one summary to one company on the channels its prefs allow.
 * `emailHtml` is a function so we only build the HTML when email is on and
 * we can hand it the freshly-minted manage link.
 */
export async function deliverSummary(opts: {
  db: SupabaseClient
  company: DeliveryTarget
  channels: DeliveryChannels
  /** Notification/ntfy title and email subject. */
  title: string
  subject: string
  /** The plain body — push, SMS and the webhook mirror all use this. */
  text: string
  emailHtml?: (manageUrl: string | null) => string
  /** In-app path the notification opens. */
  clickPath?: string
}): Promise<DeliveryResult> {
  const { db, company, channels } = opts
  const clickPath = opts.clickPath ?? '/command'
  const manageUrl = notifyPrefsUrl(company.id)
  const out: DeliveryResult = { pushed: 0, emailed: false, texted: false, webhooked: false }

  if (channels.push) {
    try {
      const { sendPushToCompanyPlain } = await import('./push')
      out.pushed = await sendPushToCompanyPlain(company.id, {
        title: opts.title,
        // A lock screen shows ~2 lines. The full read is one tap away.
        body: opts.text.length > 240 ? `${opts.text.slice(0, 237)}…` : opts.text,
        url: clickPath,
      })
    } catch { /* push is best-effort */ }
  }

  if (channels.email && company.alert_email && opts.emailHtml) {
    try {
      const { sendEmail } = await import('./email')
      const r = await sendEmail(company.alert_email, opts.subject, opts.emailHtml(manageUrl))
      out.emailed = r.ok
    } catch { /* email is best-effort */ }
  }

  if (channels.sms && company.alert_phone) {
    try {
      const { sendAlertSms } = await import('./notify')
      const { smsOptOut } = await import('./weekly-digest')
      // sendAlertSms trims at 320 — reserve room so the opt-out link, the
      // one part that must survive, is never the thing that gets cut.
      const tail = smsOptOut(manageUrl)
      const room = 300 - tail.length
      const body = `${company.name}: ${opts.text}`
      const r = await sendAlertSms(company.alert_phone, `${body.length > room ? `${body.slice(0, room - 1)}…` : body}${tail}`)
      out.texted = r.ok
    } catch { /* sms is best-effort */ }
  }

  // Founder mirror, last and gated.
  if (process.env.NOTIFY_WEBHOOK_URL && (await isPlatformOwnerCompany(db, company.id))) {
    out.webhooked = await mirrorToWebhook(opts.title, opts.text, clickPath, company.name)
  }

  return out
}

/** Did anything actually go out? Used to decide whether to stamp last-sent. */
export const delivered = (r: DeliveryResult): boolean =>
  r.pushed > 0 || r.emailed || r.texted || r.webhooked
