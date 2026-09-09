'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions, getRealPermissions } from '@/lib/permissions-server'
import { BRAND_DOMAIN, BRAND_URL } from '@/lib/brand'
import { notifyChannels } from '@/lib/notify'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface CompanyCard {
  id: string
  last4: string
  label: string | null
  user_id: string | null
}

export interface InstantChaseSetup {
  /** Full inbound address once enabled, e.g. receipts-dillard@hammertrack.ai. */
  address: string | null
  cards: CompanyCard[]
  members: { id: string; name: string; phone: string | null }[]
  /** The three legs of the chase and whether each can fire right now. */
  ready: { inbound: boolean; push: boolean; sms: boolean }
}

/** Normalize a typed US cell number to E.164; null when it is not a number. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return null
}

/** Everything the Instant Chase setup card needs, in one round trip. */
export async function getInstantChaseSetup(): Promise<InstantChaseSetup> {
  const ready = {
    inbound: !!process.env.RESEND_INBOUND_SECRET,
    push: !!(process.env.FCM_SERVICE_ACCOUNT || process.env.FCM_SERVER_KEY),
    sms: notifyChannels().sms,
  }
  if (isMock) return { address: null, cards: [], members: [], ready }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const [{ data: co }, cardsRes, profilesRes] = await Promise.all([
    supabase.from('companies').select('inbound_slug').eq('id', companyId).single(),
    supabase.from('company_cards').select('id, last4, label, user_id').eq('company_id', companyId).order('last4'),
    supabase.from('profiles').select('id, name, email, phone').eq('company_id', companyId),
  ])
  // A pre-099 profiles table has no phone column — retry without it.
  const profiles = profilesRes.error
    ? ((await supabase.from('profiles').select('id, name, email').eq('company_id', companyId)).data ?? []).map((p) => ({ ...p, phone: null }))
    : profilesRes.data ?? []
  return {
    address: co?.inbound_slug ? `receipts-${co.inbound_slug}@${BRAND_DOMAIN}` : null,
    // Table may predate migration 045 — treat an error as "not set up yet".
    cards: (cardsRes.error ? [] : cardsRes.data ?? []) as CompanyCard[],
    members: profiles.map((p) => ({ id: p.id as string, name: (p.name as string) || (p.email as string) || 'Unnamed', phone: (p.phone as string | null) ?? null })),
    ready,
  }
}

/** Turn the feature on: mint the company's inbound address from its name. */
export async function enableInstantChaseAction(): Promise<{ ok: boolean; address?: string; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!(await getMyPermissions()).canManageBilling) {
    return { ok: false, error: 'You need the Billing permission (Team page) for this.' }
  }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: co } = await supabase.from('companies').select('name, inbound_slug').eq('id', companyId).single()
  if (!co) return { ok: false, error: 'Company not found' }
  if (co.inbound_slug) return { ok: true, address: `receipts-${co.inbound_slug}@${BRAND_DOMAIN}` }

  const base = (co.name || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'company'
  // Collide → add a short suffix rather than failing (two "Dillard"s exist).
  for (const slug of [base, `${base}-${companyId.slice(0, 4)}`]) {
    const { error } = await supabase.from('companies').update({ inbound_slug: slug }).eq('id', companyId)
    if (!error) {
      revalidatePath('/receipts')
      return { ok: true, address: `receipts-${slug}@${BRAND_DOMAIN}` }
    }
    if (!/duplicate|unique/i.test(error.message)) return { ok: false, error: 'Enable failed — run migration 045 first.' }
  }
  return { ok: false, error: 'Could not reserve an address — contact support.' }
}

/** Map a card to the person carrying it; optionally set that person's cell so
 *  the chase can TEXT them (profiles.phone, 099). */
export async function saveCardAction(card: { last4: string; label: string; userId: string; phone?: string }): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!(await getMyPermissions()).canManageBilling) {
    return { ok: false, error: 'You need the Billing permission (Team page) for this.' }
  }
  const last4 = card.last4.replace(/\D/g, '')
  if (last4.length !== 4) return { ok: false, error: 'Enter the card’s last 4 digits.' }
  const phone = card.phone?.trim() ? normalizePhone(card.phone) : undefined
  if (card.phone?.trim() && !phone) return { ok: false, error: 'That cell number does not look right — 10 digits, US.' }
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { error } = await supabase.from('company_cards').upsert({
    company_id: companyId,
    last4,
    label: card.label.trim().slice(0, 60) || null,
    user_id: card.userId || null,
  }, { onConflict: 'company_id,last4' })
  if (error) return { ok: false, error: 'Save failed — run migration 045 first.' }
  if (phone && card.userId) {
    // Profiles are self-edit under RLS; a billing manager setting a teammate's
    // cell goes through the service client, scoped to this company.
    try {
      await createServiceClient().from('profiles').update({ phone }).eq('id', card.userId).eq('company_id', companyId)
    } catch { /* pre-099 — the push still works */ }
  }
  revalidatePath('/receipts')
  return { ok: true }
}

export async function deleteCardAction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!(await getMyPermissions()).canManageBilling) {
    return { ok: false, error: 'You need the Billing permission (Team page) for this.' }
  }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  await supabase.from('company_cards').delete().eq('id', id).eq('company_id', companyId)
  revalidatePath('/receipts')
  return { ok: true }
}

/**
 * Prove the loop without swiping a card: creates a real $12.34 "test swipe"
 * charge on YOUR name and fires the very same ping the webhook fires — push to
 * your devices (tap opens the camera), text to your cell if we have it. Snap
 * any photo to close it; it then reads like any other captured charge.
 */
export async function sendTestChargeAction(): Promise<{ ok: boolean; link?: string; pushed?: number; texted?: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const perms = await getRealPermissions()
  if (!perms.canManageBilling || !perms.userId || !perms.companyId) {
    return { ok: false, error: 'You need the Billing permission (Team page) for this.' }
  }
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { randomBytes } = await import('crypto')
  const db = createServiceClient()
  const token = randomBytes(18).toString('base64url')
  const { data: card } = await db.from('company_cards').select('last4')
    .eq('company_id', perms.companyId).eq('user_id', perms.userId).limit(1).maybeSingle()
  const now = new Date().toISOString()
  const { error } = await db.from('expenses').insert({
    company_id: perms.companyId,
    source: 'card_alert',
    merchant: 'HammerTrack test swipe',
    amount: 12.34,
    txn_date: now.slice(0, 10),
    last4: card?.last4 ?? null,
    cardholder_user_id: perms.userId,
    status: 'needs_receipt',
    external_id: `test:${perms.userId.slice(0, 8)}:${Date.now()}`,
    capture_token: token,
    nag_level: 1,
    chased_at: now,
    note: 'Test charge from the Receipts page — snap any photo to close it.',
  })
  if (error) return { ok: false, error: 'Could not create the test charge — run migration 045 first.' }

  const link = `${BRAND_URL}/r/${token}`
  const body = `$12.34 at HammerTrack test swipe — snap the receipt: ${link}`
  let pushed = 0
  try {
    const { sendPushToUser } = await import('@/lib/push')
    pushed = await sendPushToUser(perms.companyId, perms.userId, { title: '🧾 Snap the receipt? (test)', body, url: `/r/${token}` })
  } catch { /* best-effort */ }
  let texted = false
  try {
    const { data: me } = await db.from('profiles').select('phone').eq('id', perms.userId).maybeSingle()
    if (me?.phone) {
      const { sendAlertSms } = await import('@/lib/notify')
      texted = (await sendAlertSms(String(me.phone), `HammerTrack test: ${body}`)).ok
    }
  } catch { /* best-effort */ }
  revalidatePath('/receipts')
  return { ok: true, link, pushed, texted }
}
