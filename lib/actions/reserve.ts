'use server'

import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase-server'
import { sendEmail, escapeHtml } from '@/lib/email'
import { BRAND_DOMAIN } from '@/lib/brand'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// Best-effort abuse limits (sec-check, Aug 11). In-memory state survives on
// warm lambdas — not bulletproof across instances, but it turns "free
// email-bomb + junk-row firehose" into "annoying at worst". If real spam
// shows up, the upgrade path is Cloudflare Turnstile verified server-side.
const ipHits = new Map<string, { n: number; at: number }>()
const IP_WINDOW_MS = 60_000
const IP_MAX = 3
// Owner-email cap: every lead emails (leads are precious — a suppressed
// one was LOST until a later lead flushed it; ship-check, Aug 12), but at
// most N sends/hour per instance so a flood can't burn the Resend quota.
// The reservations table is always the source of truth.
let emailWindowStart = 0
let emailsThisWindow = 0
const EMAIL_WINDOW_MS = 60 * 60_000
const EMAIL_WINDOW_MAX = 20

const FALLBACK = `Could not save your spot — email sales@${BRAND_DOMAIN} and we'll hold it by hand.`

export interface ReservationInput {
  company: string
  name: string
  phone: string
  email?: string
  machines?: number
  tools?: number
  note?: string
  /** Honeypot — real users never fill this; bots do. */
  website?: string
}

/** Public Founding-25 reservation from /reserve — no auth, service-role
 *  insert (migration 062). Best-effort email ping so the list gets worked
 *  the same day. */
export async function createReservationAction(input: ReservationInput): Promise<{ ok: boolean; error?: string }> {
  if (input.website) return { ok: true } // bot fed the honeypot — pretend

  const ip = headers().get('x-real-ip') || headers().get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const now = Date.now()
  const h = ipHits.get(ip)
  if (h && now - h.at < IP_WINDOW_MS && h.n >= IP_MAX) {
    return { ok: false, error: `Too many attempts — email sales@${BRAND_DOMAIN} and we'll hold your spot by hand.` }
  }
  ipHits.set(ip, h && now - h.at < IP_WINDOW_MS ? { n: h.n + 1, at: h.at } : { n: 1, at: now })
  if (ipHits.size > 5000) ipHits.clear()

  const company = (input.company ?? '').trim().slice(0, 120)
  const name = (input.name ?? '').trim().slice(0, 120)
  const phone = (input.phone ?? '').trim().slice(0, 40)
  const email = (input.email ?? '').trim().slice(0, 160) || null
  const note = (input.note ?? '').trim().slice(0, 500) || null
  const machines = Math.max(0, Math.min(500, Math.round(Number(input.machines) || 0)))
  const tools = Math.max(0, Math.min(2000, Math.round(Number(input.tools) || 0)))
  if (!company || !name || !phone) return { ok: false, error: 'Company, name, and phone are required.' }
  if (isMock) return { ok: true } // demo environment — nothing to store

  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('reservations').insert({ company, name, phone, email, machines, tools, note })
    if (error) throw error
  } catch (err) {
    console.error('Reservation insert failed', err)
    return { ok: false, error: FALLBACK }
  }

  // Ping the owner so the lead gets a call while it's hot. AWAITED — a
  // fire-and-forget fetch in a server action gets frozen with the lambda
  // and sometimes never sends (ship-check, Aug 12). sendEmail is bounded
  // (10s timeout) and never throws, so this can't hang the user.
  if (now - emailWindowStart > EMAIL_WINDOW_MS) { emailWindowStart = now; emailsThisWindow = 0 }
  if (emailsThisWindow < EMAIL_WINDOW_MAX) {
    emailsThisWindow++
    const e = escapeHtml
    await sendEmail(
      `brian@${BRAND_DOMAIN}`,
      `Founding 25 reservation: ${company} (${machines} machines, ${tools} tools)`,
      `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
        <p><b>${e(company)}</b> just reserved a Founding 25 spot.</p>
        <p>${e(name)} · ${e(phone)}${email ? ` · ${e(email)}` : ''}</p>
        <p>${machines} machines · ${tools} tools${note ? `<br/>Note: ${e(note)}` : ''}</p>
        <p>Call while it's hot.</p>
      </div>`
    )
  }

  return { ok: true }
}
