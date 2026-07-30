'use server'

import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { BRAND_URL, BRAND_NAME } from '@/lib/brand'
import { PLANS, stripe, planLineItems } from '@/lib/stripe'

export interface BillingActionResult {
  ok: boolean
  /** Where to send the browser next (Stripe-hosted page). */
  url?: string
  error?: string
}

/** The company row's billing columns, tolerant of a pre-042 database. */
async function readBilling(companyId: string) {
  const { createServiceClient } = await import('@/lib/supabase-server')
  const { data } = await createServiceClient()
    .from('companies').select('*').eq('id', companyId).maybeSingle()
  return {
    name: (data?.name as string) ?? BRAND_NAME,
    email: (data?.alert_email as string | null) ?? null,
    customerId: (data?.stripe_customer_id as string | null) ?? null,
  }
}

/**
 * Start checkout for a plan.
 *
 * Quantities are set by the CUSTOMER on Stripe's page, not by us — this is
 * per-asset pricing, and the buyer knows their own machine count better than
 * any form we could put in front of them first.
 */
export async function startCheckoutAction(planId: string): Promise<BillingActionResult> {
  const perms = await getMyPermissions()
  if (!perms.canManageBilling) return { ok: false, error: 'You need billing permission to subscribe.' }

  const s = stripe()
  if (!s) return { ok: false, error: 'Billing is not configured yet (STRIPE_SECRET_KEY unset).' }

  const plan = PLANS[planId]
  if (!plan) return { ok: false, error: 'Unknown plan.' }
  const items = planLineItems(plan)
  if (!items) {
    return {
      ok: false,
      error: `Prices not configured — set ${plan.lines.map((l) => l.priceEnv).join(' and ')} in the hosting env.`,
    }
  }

  try {
    const companyId = await getCurrentCompanyId()
    const co = await readBilling(companyId)
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      line_items: items.map((i) => ({
        price: i.price,
        quantity: i.quantity,
        adjustable_quantity: { enabled: i.adjustable, minimum: 0, maximum: 999 },
      })),
      // Reuse the customer when we have one so a re-subscribe doesn't create
      // a duplicate Stripe customer and split the billing history in two.
      ...(co.customerId ? { customer: co.customerId } : { customer_email: co.email ?? undefined }),
      // The company id is how the webhook knows WHO paid. Without it a
      // completed checkout is an anonymous payment we can't attach to anyone.
      client_reference_id: companyId,
      subscription_data: { metadata: { company_id: companyId, plan: plan.id } },
      metadata: { company_id: companyId, plan: plan.id },
      billing_address_collection: 'required',
      allow_promotion_codes: true,
      success_url: `${BRAND_URL}/settings?billing=success`,
      cancel_url: `${BRAND_URL}/settings?billing=canceled`,
    })
    return session.url ? { ok: true, url: session.url } : { ok: false, error: 'Stripe returned no checkout URL.' }
  } catch (err) {
    console.error('checkout failed', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Could not start checkout.' }
  }
}

/**
 * Send the owner to Stripe's hosted billing portal — update card, view
 * invoices, cancel. Deliberately not rebuilt in-app: card handling is exactly
 * the surface worth keeping off our servers, and cancel-anytime is part of
 * the Founding 25 promise, so it should be genuinely self-serve.
 */
export async function openBillingPortalAction(): Promise<BillingActionResult> {
  const perms = await getMyPermissions()
  if (!perms.canManageBilling) return { ok: false, error: 'You need billing permission to manage the subscription.' }

  const s = stripe()
  if (!s) return { ok: false, error: 'Billing is not configured yet.' }

  try {
    const companyId = await getCurrentCompanyId()
    const co = await readBilling(companyId)
    if (!co.customerId) return { ok: false, error: 'No Stripe customer yet — subscribe first.' }
    const session = await s.billingPortal.sessions.create({
      customer: co.customerId,
      return_url: `${BRAND_URL}/settings`,
    })
    return { ok: true, url: session.url }
  } catch (err) {
    console.error('portal failed', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Could not open the billing portal.' }
  }
}
