import Link from 'next/link'
import type { Metadata } from 'next'
import { Check } from 'lucide-react'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'

export const metadata: Metadata = {
  title: 'HammerTrack — Pricing',
  description:
    'Everything Tenna does — vehicles, equipment, Bluetooth tools — at a fraction of the price, with AI alerts and QuickBooks built in.',
}

const TIERS = [
  {
    name: 'Starter',
    price: '$3',
    unit: '/asset/mo',
    blurb: 'For small crews getting started.',
    cta: 'Start free pilot',
    highlight: false,
    features: [
      'Live GPS map', 'Bluetooth tool tracking', 'Geofences & alerts',
      'After-hours theft alerts', 'Up to 25 assets', 'Email support',
    ],
  },
  {
    name: 'Pro',
    price: '$5',
    unit: '/asset/mo',
    blurb: 'For growing contractors.',
    cta: 'Start free pilot',
    highlight: true,
    features: [
      'Everything in Starter', 'AI anomaly & theft detection', 'QuickBooks integration',
      'Maintenance & service records', 'Utilization & job-site reports', 'Unlimited assets', 'Priority support',
    ],
  },
  {
    name: 'Fleet',
    price: 'Custom',
    unit: '',
    blurb: 'For large fleets & multi-site.',
    cta: 'Contact us',
    href: '/contact',
    highlight: false,
    features: [
      'Everything in Pro', 'Dedicated onboarding', 'Custom integrations',
      'SLA & phone support', 'Volume hardware pricing',
    ],
  },
]

const FAQ = [
  {
    q: 'What do the trackers cost?',
    a: 'At-cost, no markup: OBD2 plug-ins for trucks run about $40–60, GPS units for equipment $60–90, and Bluetooth tool tags about $20. Free pilots include loaner trackers, and Fleet plans get volume hardware pricing.',
  },
  {
    q: 'Is there a contract?',
    a: 'No. Month-to-month, cancel anytime from your account, no setup fees. The free pilot doesn’t even take a credit card.',
  },
  {
    q: 'What counts as an asset?',
    a: 'Anything with a tracker or tag on it — a truck, an excavator, a trailer, a crew member clocking in by phone, or a $20-tagged tool kit. You only pay for what you track.',
  },
  {
    q: 'Who installs the hardware?',
    a: 'You do, in minutes — OBD2 plugs into the port under the dash, equipment units mount with bolts or adhesive, tags stick to tools. No install crew, no downtime.',
  },
  {
    q: 'Who owns my data?',
    a: 'You do. Export it anytime, and if you leave we delete it. We never sell or share your fleet’s location data.',
  },
]

const VS_TENNA = [
  ['$0 setup fees', 'Tenna: $500+ setup'],
  ['Bluetooth tools included', 'Tenna: paid add-on'],
  ['AI alerts included', 'Tenna: enterprise only'],
  ['QuickBooks built in', 'Tenna: enterprise only'],
  ['Self-serve in minutes', 'Tenna: sales-led onboarding'],
  ['~$3–8/asset/mo', 'Tenna: $15–25/asset/mo'],
]

export default function PricingPage() {
  return (
    <div className="relative min-h-screen bg-navy-950 text-ink font-sans">
      <div className="fixed inset-0 z-0 pointer-events-none brand-glow" />
      <SiteNav />

      <main className="relative z-10 max-w-6xl mx-auto px-6 pb-20">
        <div className="text-center py-12">
          <h1 className="font-display font-black text-4xl md:text-5xl tracking-tight text-balance">
            Asset tracking that pays for itself
          </h1>
          <p className="text-muted mt-4 max-w-xl mx-auto text-lg">
            Everything Tenna does — vehicles, equipment, Bluetooth tools — at a fraction of the price,
            with AI alerts and QuickBooks built in.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-2xl p-6 flex flex-col border ${
                tier.highlight
                  ? 'bg-navy-900 border-amber/60 shadow-glow-amber ring-1 ring-amber/30'
                  : 'bg-navy-900 border-navy-800'
              }`}
            >
              {tier.highlight && (
                <span className="self-start bg-amber text-[#1a1100] font-mono text-[11px] font-bold px-2 py-0.5 rounded-full mb-2 uppercase tracking-wider">
                  Most popular
                </span>
              )}
              <h2 className="font-display font-extrabold text-lg">{tier.name}</h2>
              <p className="text-sm text-faint mb-4">{tier.blurb}</p>
              <div className="mb-4">
                <span className="font-display font-black text-4xl">{tier.price}</span>
                <span className="text-faint">{tier.unit}</span>
              </div>
              <ul className="space-y-2.5 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="h-4 w-4 mt-0.5 flex-shrink-0 text-teal" />
                    <span className="text-muted">{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={(tier as { href?: string }).href ?? '/register'}
                className={`mt-6 text-center font-display font-bold rounded-xl py-3 transition-colors ${
                  tier.highlight
                    ? 'bg-amber text-[#1a1100] hover:bg-amber-600'
                    : 'bg-white/[0.04] border border-navy-700 text-ink hover:bg-white/[0.07]'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Hardware — the question every prospect asks first */}
        <section className="mt-6 rounded-2xl border border-navy-800 bg-navy-900 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="flex-1">
            <h3 className="font-display font-bold text-[15px]">Hardware at cost — no markup, no rental games</h3>
            <p className="text-[13px] text-faint mt-1">
              OBD2 plug-ins ~$40–60 · equipment GPS ~$60–90 · Bluetooth tool tags ~$20.
              Yours to keep. Free pilots ship with loaner trackers.
            </p>
          </div>
          <Link href="/register" className="flex-none font-display font-bold text-sm rounded-xl px-4 py-2.5 bg-white/[0.04] border border-navy-700 text-ink hover:bg-white/[0.07] transition-colors">
            Start free pilot
          </Link>
        </section>

        <section className="mt-12 bg-navy-900 border border-navy-800 rounded-2xl p-7">
          <h3 className="font-display font-bold text-lg mb-5 text-center">Why contractors switch from Tenna</h3>
          <div className="grid sm:grid-cols-2 gap-3.5 max-w-2xl mx-auto">
            {VS_TENNA.map(([us, them]) => (
              <div key={us} className="flex items-start gap-2.5">
                <Check className="h-5 w-5 text-teal flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-ink">{us}</p>
                  <p className="text-xs text-faint line-through">{them}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-12 max-w-2xl mx-auto">
          <h3 className="font-display font-bold text-lg mb-5 text-center">Common questions</h3>
          <div className="space-y-3">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group rounded-xl border border-navy-800 bg-navy-900 px-5 py-4">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 font-display font-bold text-[14.5px] text-ink">
                  {q}
                  <span className="text-faint transition-transform group-open:rotate-45 text-lg leading-none">+</span>
                </summary>
                <p className="text-[13.5px] text-muted mt-3 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
