'use client'

import { useState } from 'react'
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { startCheckoutAction, openBillingPortalAction } from '@/lib/actions/billing'

interface Props {
  configured: boolean
  canManage: boolean
  plan: string
  status: string | null
  statusText: string
  active: boolean
  periodEnd: string | null
  hasCustomer: boolean
}

/**
 * Subscription state and the two buttons that matter: subscribe, or manage.
 * Management is Stripe's hosted portal rather than screens we maintain —
 * card handling is the one surface worth keeping off our servers, and
 * "cancel anytime" should be genuinely self-serve, not an email to Brian.
 */
export function BillingCard({
  configured, canManage, plan, status, statusText, active, periodEnd, hasCustomer,
}: Props) {
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const go = async (which: 'checkout' | 'portal') => {
    setBusy(which); setErr(null)
    try {
      const r = which === 'checkout' ? await startCheckoutAction('founding25') : await openBillingPortalAction()
      if (r.ok && r.url) { window.location.href = r.url; return }
      setErr(r.error ?? 'Something went wrong.')
    } catch {
      setErr('Something went wrong. Please try again.')
    } finally { setBusy(null) }
  }

  return (
    <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
      <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-faint" />
        <h2 className="font-semibold text-sm text-muted">Billing</h2>
        <span
          className={
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold border ' +
            (active
              ? 'bg-teal/15 border-teal/40 text-teal'
              : status
                ? 'bg-alert/15 border-alert/40 text-alert'
                : 'bg-navy-800 border-navy-700 text-faint')
          }
        >
          {statusText}
        </span>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-faint">Plan</span>
          <span className="text-sm text-ink font-medium">
            {plan === 'founding25' ? 'Founding 25' : plan === 'starter' ? 'Starter (no subscription)' : plan}
          </span>
        </div>

        {periodEnd && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-faint">Renews</span>
            <span className="text-sm text-ink font-mono">
              {new Date(periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        )}

        {!configured ? (
          <p className="text-[12px] text-faint leading-snug rounded-lg border border-navy-800 bg-navy-950 px-3 py-2">
            Billing isn&apos;t configured on this deployment. Set <span className="font-mono text-muted">STRIPE_SECRET_KEY</span>,{' '}
            <span className="font-mono text-muted">STRIPE_WEBHOOK_SECRET</span>, and the price IDs to enable it.
          </p>
        ) : !canManage ? (
          <p className="text-[12px] text-faint">Ask an admin to manage the subscription.</p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {!active && (
              <button
                onClick={() => go('checkout')}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm px-4 py-2 hover:bg-amber-600 disabled:opacity-60"
              >
                {busy === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                Subscribe — Founding 25
              </button>
            )}
            {hasCustomer && (
              <button
                onClick={() => go('portal')}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-navy-700 text-muted text-sm px-4 py-2 hover:text-ink hover:border-navy-600 disabled:opacity-60"
              >
                {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                Manage billing
              </button>
            )}
          </div>
        )}

        {!active && configured && canManage && (
          <p className="text-[11px] text-faint leading-snug">
            $6 per tracked machine + $3 per tool tag, monthly. You set the counts at checkout. Cancel anytime.
          </p>
        )}

        {err && <p className="text-[12px] text-alert leading-snug">{err}</p>}
      </div>
    </section>
  )
}
