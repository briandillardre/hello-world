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
// The notify email is throttled to one per 10 min per instance — a burst of
// reservations sends ONE email carrying the count; the table is the truth.
let pendingSinceEmail = 0
let lastEmailAt = 0
const EMAIL_GAP_MS = 10 * 60_000

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

  const ip = headers().get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
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

  // Ping the owner so the lead gets a call while it's hot — throttled, and
  // every user-supplied string is HTML-escaped (link/markup injection into
  // the owner's inbox otherwise). Best-effort, never a blocker.
  pendingSinceEmail++
  if (now - lastEmailAt > EMAIL_GAP_MS) {
    const extra = pendingSinceEmail - 1
    pendingSinceEmail = 0
    lastEmailAt = now
    const e = escapeHtml
    sendEmail(
      `brian@${BRAND_DOMAIN}`,
      `Founding 25 reservation: ${company} (${machines} machines, ${tools} tools)${extra > 0 ? ` +${extra} more` : ''}`,
      `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
        <p><b>${e(company)}</b> just reserved a Founding 25 spot.</p>
        <p>${e(name)} · ${e(phone)}${email ? ` · ${e(email)}` : ''}</p>
        <p>${machines} machines · ${tools} tools${note ? `<br/>Note: ${e(note)}` : ''}</p>
        ${extra > 0 ? `<p><b>${extra} more reservation${extra === 1 ? '' : 's'}</b> came in since the last email — full list in Supabase.</p>` : ''}
        <p>Call while it's hot.</p>
      </div>`
    ).catch(() => { /* email is a bonus, never a blocker */ })
  }

  return { ok: true }
}
