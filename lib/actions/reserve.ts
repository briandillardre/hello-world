'use server'

import { createServiceClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/email'
import { BRAND_DOMAIN } from '@/lib/brand'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

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
    return { ok: false, error: 'Could not save your spot — call or text Brian directly instead.' }
  }

  // Ping the owner so the lead gets a call while it's hot. Best-effort.
  sendEmail(
    `brian@${BRAND_DOMAIN}`,
    `Founding 25 reservation: ${company} (${machines} machines, ${tools} tools)`,
    `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">
      <p><b>${company}</b> just reserved a Founding 25 spot.</p>
      <p>${name} · ${phone}${email ? ` · ${email}` : ''}</p>
      <p>${machines} machines · ${tools} tools${note ? `<br/>Note: ${note}` : ''}</p>
      <p>Call while it's hot.</p>
    </div>`
  ).catch(() => { /* email is a bonus, never a blocker */ })

  return { ok: true }
}
