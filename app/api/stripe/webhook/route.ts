import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
// Stripe retries on non-2xx, so a slow DB write is safer than a timeout —
// give the handler room rather than letting the platform default cut it off
// mid-write and cause a duplicate delivery.
export const maxDuration = 30

/**
 * Stripe → HammerTrack subscription state.
 *
 * This endpoint is the ONLY thing that writes billing state. Checkout success
 * redirects are not trustworthy for that: the customer can close the tab
 * before the redirect, and a redirect URL can be forged by anyone who reads
 * it off the page. The webhook is signed, so it's the one channel that proves
 * Stripe actually said this.
 *
 * Everything is keyed on company_id, which we set as client_reference_id and
 * subscription metadata at checkout. A subscription without it can't be
 * attributed, so we log loudly rather than guessing.
 */
export async function POST(req: NextRequest) {
  const s = stripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!s || !secret) {
    // Unconfigured deployment (demo, local): accept and ignore, so Stripe
    // doesn't accumulate failed deliveries against a URL that isn't wired up.
    return NextResponse.json({ ok: true, ignored: 'billing not configured' })
  }

  const sig = req.headers.get('stripe-signature')
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    // Raw body — Stripe signs the exact bytes, so parsing first breaks it.
    const raw = await req.text()
    event = s.webhooks.constructEvent(raw, sig, secret)
  } catch (err) {
    console.error('stripe signature verification failed', err)
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createServiceClient()

  /** Write subscription state for whichever company this subscription belongs to. */
  const applySubscription = async (sub: Stripe.Subscription) => {
    const companyId = sub.metadata?.company_id
    if (!companyId) {
      console.error('stripe subscription without company_id metadata', sub.id)
      return
    }
    const item = sub.items?.data?.[0]
    const patch: Record<string, unknown> = {
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      stripe_subscription_id: sub.id,
      subscription_status: sub.status,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      current_period_end: item?.current_period_end
        ? new Date(item.current_period_end * 1000).toISOString()
        : null,
    }
    // Entitlements read `plan`. Paid statuses promote; anything else drops
    // back to starter so a lapsed card doesn't silently keep paid features.
    const paid = sub.status === 'active' || sub.status === 'trialing'
    patch.plan = paid ? (sub.metadata?.plan ?? 'founding25') : 'starter'

    const { error } = await supabase.from('companies').update(patch).eq('id', companyId)
    if (error) console.error('billing state write failed', error, sub.id)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const companyId = session.client_reference_id ?? session.metadata?.company_id
        // Record the customer immediately so the billing portal works even if
        // the subscription event lands late or out of order.
        if (companyId && session.customer) {
          await supabase.from('companies')
            .update({ stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer.id })
            .eq('id', companyId)
        }
        if (session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
          await applySubscription(await s.subscriptions.retrieve(subId))
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscription(event.data.object as Stripe.Subscription)
        break
      case 'invoice.payment_failed': {
        // Don't cut access here — Stripe's dunning retries for days, and the
        // subscription.updated event will move the status to past_due/unpaid
        // when it genuinely gives up. Just make it visible.
        const inv = event.data.object as Stripe.Invoice
        console.warn('stripe payment failed', inv.id, inv.customer)
        break
      }
      default:
        break
    }
  } catch (err) {
    // 500 makes Stripe retry — right for a transient DB blip, and harmless
    // because every handler above is idempotent (it writes absolute state,
    // never increments).
    console.error('stripe webhook handler failed', event.type, err)
    return NextResponse.json({ error: 'handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
