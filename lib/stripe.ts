/**
 * Stripe billing — server-side only.
 *
 * Everything here is gated on STRIPE_SECRET_KEY. With no key the app behaves
 * exactly as it did before billing existed: the Settings card says billing
 * isn't configured, /pricing keeps pointing at register + sales email, and
 * nothing throws. That matters because the demo deployment and every local
 * checkout run without Stripe credentials.
 */

import Stripe from 'stripe'

let client: Stripe | null = null

/** Null when unconfigured — callers MUST handle that rather than assume. */
export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  if (!client) client = new Stripe(key)
  return client
}

export function billingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/**
 * The plans we actually sell, priced from docs/PRICING-TIERS.md.
 *
 * Per-asset pricing is the shape of this business, so a plan is two recurring
 * line items with customer-set quantities rather than a flat monthly fee.
 * Founding 25 is the live offer: $6/machine + $3/tag, Operate features, no
 * platform fee — deliberately below the $8 list price, for the first cohort.
 *
 * Price IDs come from env rather than being hardcoded: the same code runs
 * against test and live keys, and those have different price IDs. Create the
 * prices in the Stripe dashboard, paste the IDs into Vercel.
 */
export interface PlanLine {
  label: string
  /** Stripe Price id (price_...). */
  priceEnv: string
  /** Shown next to the quantity picker. */
  unit: string
  /** Cents, for display only — Stripe charges what the Price says. */
  amount: number
}

export interface Plan {
  id: string
  name: string
  blurb: string
  lines: PlanLine[]
}

export const FOUNDING_25: Plan = {
  id: 'founding25',
  name: 'Founding 25',
  blurb: 'Founder pricing, locked for 12 months. Operate features included, month to month, cancel anytime.',
  lines: [
    { label: 'Tracked machine', priceEnv: 'STRIPE_PRICE_MACHINE', unit: 'vehicle or equipment', amount: 600 },
    { label: 'Tool tag', priceEnv: 'STRIPE_PRICE_TAG', unit: 'Bluetooth tag', amount: 300 },
  ],
}

export const PLANS: Record<string, Plan> = { founding25: FOUNDING_25 }

/** Resolve a plan's line items to Stripe price ids, or null if any are unset. */
export function planLineItems(plan: Plan): { price: string; quantity: number; adjustable: boolean }[] | null {
  const items: { price: string; quantity: number; adjustable: boolean }[] = []
  for (const line of plan.lines) {
    const price = process.env[line.priceEnv]
    if (!price) return null
    items.push({ price, quantity: 1, adjustable: true })
  }
  return items
}

/** A subscription that entitles the company to paid features. */
export function isActiveStatus(status: string | null | undefined): boolean {
  return status === 'active' || status === 'trialing'
}

/** Human wording for the Settings card — say what's true, including the
 *  awkward states (past due, cancelling at period end). */
export function statusLabel(status: string | null | undefined, cancelAtPeriodEnd: boolean): string {
  if (!status) return 'No subscription'
  if (cancelAtPeriodEnd && isActiveStatus(status)) return 'Active — cancels at period end'
  switch (status) {
    case 'active': return 'Active'
    case 'trialing': return 'Trial'
    case 'past_due': return 'Past due — payment failed'
    case 'unpaid': return 'Unpaid — access limited'
    case 'canceled': return 'Canceled'
    case 'incomplete': return 'Incomplete — finish checkout'
    case 'incomplete_expired': return 'Checkout expired'
    default: return status
  }
}
