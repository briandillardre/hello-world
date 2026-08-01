'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { BRAND_DOMAIN } from '@/lib/brand'

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
  members: { id: string; name: string }[]
}

/** Everything the Instant Chase setup card needs, in one round trip. */
export async function getInstantChaseSetup(): Promise<InstantChaseSetup> {
  if (isMock) return { address: null, cards: [], members: [] }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const [{ data: co }, cardsRes, { data: profiles }] = await Promise.all([
    supabase.from('companies').select('inbound_slug').eq('id', companyId).single(),
    supabase.from('company_cards').select('id, last4, label, user_id').eq('company_id', companyId).order('last4'),
    supabase.from('profiles').select('id, name, email').eq('company_id', companyId),
  ])
  return {
    address: co?.inbound_slug ? `receipts-${co.inbound_slug}@${BRAND_DOMAIN}` : null,
    // Table may predate migration 045 — treat an error as "not set up yet".
    cards: (cardsRes.error ? [] : cardsRes.data ?? []) as CompanyCard[],
    members: (profiles ?? []).map((p) => ({ id: p.id as string, name: (p.name as string) || (p.email as string) || 'Unnamed' })),
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

export async function saveCardAction(card: { last4: string; label: string; userId: string }): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!(await getMyPermissions()).canManageBilling) {
    return { ok: false, error: 'You need the Billing permission (Team page) for this.' }
  }
  const last4 = card.last4.replace(/\D/g, '')
  if (last4.length !== 4) return { ok: false, error: 'Enter the card’s last 4 digits.' }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { error } = await supabase.from('company_cards').upsert({
    company_id: companyId,
    last4,
    label: card.label.trim().slice(0, 60) || null,
    user_id: card.userId || null,
  }, { onConflict: 'company_id,last4' })
  if (error) return { ok: false, error: 'Save failed — run migration 045 first.' }
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
