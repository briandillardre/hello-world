import Link from 'next/link'
import type { Metadata } from 'next'
import { Check, ShieldAlert } from 'lucide-react'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { ReserveForm } from '@/components/marketing/ReserveForm'

export const metadata: Metadata = {
  title: 'HammerTrack — Reserve a Founding 25 spot',
  description:
    'Founder pricing for 25 companies: $6/machine + $3/tool tag per month, price locked 12 months, hardware at cost, month-to-month. Hardware ships in batches — hold your spot.',
  // Next replaces the root layout's openGraph wholesale (no deep merge) —
  // siteName/type/url must be restated or shared-link previews lose them.
  openGraph: {
    title: 'Founder pricing for 25 companies. Yours if you’re early.',
    description: 'Hardware ships in batches — a refundable deposit holds your spot in line.',
    siteName: 'HammerTrack',
    type: 'website',
    url: '/reserve',
    images: [{ url: '/brand/og-reserve.png', width: 1200, height: 630, alt: 'HammerTrack Founding 25' }],
  },
  twitter: { card: 'summary_large_image', images: ['/brand/og-reserve.png'] },
}

// Everything on this page states TRUE scarcity only (splash truth rule):
// the 25-company cap, batch hardware ordering, and personal installs are
// all real constraints. No fabricated stock-outs, ever.
const TERMS = [
  '$6/machine + $3/tool tag per month',
  'Full Operate feature set included (crews, logs, maintenance, QuickBooks) — no platform fee',
  'Price locked for 12 months',
  'Hardware at cost — no markup, no setup fee',
  'Month-to-month, cancel anytime',
  'Free 30-day pilot',
  'First install done with you, in person or on the phone',
]

export default function ReservePage() {
  return (
    <div className="relative min-h-screen bg-navy-950 text-ink font-sans">
      <div className="fixed inset-0 z-0 pointer-events-none brand-glow" />
      <SiteNav />
      <main className="relative z-10 max-w-3xl mx-auto px-6 pt-8 pb-16">
        <span className="inline-flex items-center gap-2 bg-amber/10 text-amber border border-amber/30 px-3 py-1 rounded-full text-xs font-bold font-mono">
          FOUNDING 25 · FOUNDER PRICING
        </span>
        <h1 className="font-display font-black text-[2rem] md:text-4xl leading-[1.06] mt-4 text-balance">
          Hardware ships in batches.
          <span className="text-amber"> Hold yours.</span>
        </h1>
        <p className="text-muted mt-4 text-[15px] leading-relaxed max-w-xl">
          HammerTrack is opening to 25 founding companies at founder pricing.
          Tracker kits are ordered in batches and installs are done personally —
          so spots are scheduled in the order they&apos;re reserved. Reserving costs
          nothing today; a refundable deposit holds your hardware once your
          batch is scheduled.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mt-8 items-start">
          <div className="rounded-2xl bg-navy-900/70 border border-navy-700 p-5">
            <p className="font-display font-bold text-[13px] uppercase tracking-wide text-amber">The founder deal</p>
            <ul className="mt-3 space-y-2">
              {TERMS.map((t) => (
                <li key={t} className="flex items-start gap-2 text-[13px] text-muted leading-snug">
                  <Check className="h-4 w-4 text-teal flex-none mt-0.5" /> {t}
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-start gap-2 text-[12px] text-faint leading-snug">
              <ShieldAlert className="h-4 w-4 flex-none mt-0.5 text-alert" />
              The hook that pays for itself: your phone gets a text the moment a
              machine moves after hours. Verified in production on our own fleet.
            </p>
            <p className="mt-3 text-[12px] text-faint">
              Want to poke it first? <Link href="/demo" className="text-teal underline underline-offset-2">Live demo</Link> ·{' '}
              <Link href="/pricing" className="text-teal underline underline-offset-2">Full pricing</Link>
            </p>
          </div>
          <div className="rounded-2xl bg-navy-900/70 border border-navy-700 p-5">
            <p className="font-display font-bold text-[13px] uppercase tracking-wide text-ink mb-3">Hold a spot</p>
            <ReserveForm />
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
