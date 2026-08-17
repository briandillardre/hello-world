import Link from 'next/link'
import type { Metadata } from 'next'
import { Check, Mail } from 'lucide-react'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { BRAND_EMAIL_SALES } from '@/lib/brand'

// No personal contact info on the public site (owner ask, Jul 23).
const SALES_EMAIL = BRAND_EMAIL_SALES
const SALES_MAILTO = `mailto:${BRAND_EMAIL_SALES}?subject=${encodeURIComponent('HammerTrack — pricing question')}`

export const metadata: Metadata = {
  title: 'HammerTrack — Pricing',
  description:
    'Everything Tenna does — vehicles, equipment, Bluetooth tools — at about half the price, with AI alerts and QuickBooks built in.',
  openGraph: {
    title: 'About half the price of Tenna. $0 setup.',
    description: 'Trucks, machines & Bluetooth tools on one map — hardware at cost, no markup, cancel anytime.',
    images: [{ url: '/brand/og-pricing.png', width: 1200, height: 630, alt: 'HammerTrack pricing' }],
  },
  twitter: { card: 'summary_large_image', images: ['/brand/og-pricing.png'] },
}

// The REAL pricing model (docs/PRICING-TIERS.md): per-machine base + a
// platform fee that splits the software tiers. The page previously showed an
// invented $3/$5/custom scheme that matched neither the tier doc nor what
// Stripe actually charges — the exact marketing/product drift this page is
// supposed to prevent.
const TIERS = [
  {
    name: 'Track',
    price: '$8',
    unit: '/machine/mo',
    sub: 'Tool tags $3/mo · no platform fee',
    blurb: '“Where’s my stuff.”',
    cta: 'Start free pilot',
    highlight: false,
    features: [
      'Live map — trucks, equipment, Bluetooth tools',
      'After-hours theft & left-site alerts',
      'Job-site & yard zones',
      'Site log, trips & utilization reports',
      'Unlimited users — never per-seat',
    ],
  },
  {
    name: 'Operate',
    price: '$8',
    unit: '/machine/mo',
    sub: '+ $49/mo platform · 25 tool tags included',
    blurb: '“Run my crews on it.”',
    cta: 'Start free pilot',
    highlight: true,
    features: [
      'Everything in Track',
      'Time clock, daily logs & QR equipment checks',
      'Maintenance schedules + service history',
      'QuickBooks sync — invoices, expenses, receipts',
      'Unlimited users — never per-seat',
    ],
  },
  {
    name: 'Run',
    price: '$8',
    unit: '/machine/mo',
    sub: 'platform priced with you — talk to us · 100 tags included',
    blurb: '“Run the company on it.”',
    cta: 'Talk to us',
    href: 'mailto:sales@hammertrack.ai?subject=HammerTrack%20Run%20tier',
    highlight: false,
    features: [
      'Everything in Operate',
      'AI assistant + daily digest',
      'API access & exports',
      'Priority support',
      'Unlimited users — never per-seat',
    ],
  },
]

const FAQ = [
  {
    q: 'What do the trackers cost?',
    a: 'At-cost, no markup: OBD2 plug-ins for trucks are about $86, GPS units for equipment about $85, and Bluetooth tool tags about $20 — exactly what we pay our supplier. Free pilots include loaner trackers.',
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
  ['$8/machine · $3/tag', 'Tenna: $15–25/asset + setup'],
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

        {/* The offer that's actually live and purchasable right now. */}
        <section className="mb-8 rounded-2xl border border-amber/50 bg-gradient-to-r from-amber/10 to-transparent p-6 sm:flex items-center gap-6">
          <div className="flex-1">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-amber">Founding 25 — first 25 companies</p>
            <h2 className="font-display font-extrabold text-xl mt-1">$6/machine + $3/tag. Operate features included. No platform fee.</h2>
            <p className="text-[13px] text-muted mt-1.5 leading-relaxed">
              Founder pricing locked for 12 months, hardware at cost, month-to-month, cancel anytime.
              You&apos;re helping us build it — you keep the price.
            </p>
          </div>
          <div className="flex-none mt-4 sm:mt-0 flex flex-col items-stretch gap-2">
            <Link href="/reserve" className="inline-block text-center font-display font-bold rounded-xl px-6 py-3 bg-amber text-[#1a1100] hover:bg-amber-600 transition-colors">
              Claim a founding spot
            </Link>
            <p className="text-[10.5px] text-faint text-center">Hardware ships in batches — reserving holds yours.</p>
          </div>
        </section>

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
              <div className="mb-1">
                <span className="font-display font-black text-4xl">{tier.price}</span>
                <span className="text-faint">{tier.unit}</span>
              </div>
              <p className="text-[12px] text-teal/90 font-medium mb-4">{(tier as { sub?: string }).sub}</p>
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

        <p className="text-center text-[12.5px] text-faint mt-4">
          {/* Run stays "priced with you" — publishing a typical-customer Run
              total would leak the platform fee by arithmetic (owner rule). */}
          Typical customer — 8 machines, 12 tags: <span className="text-muted">Track $100/mo · Operate $113/mo · Run priced with you.</span>{' '}
          Tenna quotes the same fleet at $120–200/mo <em>plus</em> $500 setup.
        </p>

        {/* Hardware — the question every prospect asks first */}
        <section className="mt-6 rounded-2xl border border-navy-800 bg-navy-900 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="flex-1">
            <h3 className="font-display font-bold text-[15px]">Hardware at cost — no markup, no rental games</h3>
            <p className="text-[13px] text-faint mt-1">
              OBD2 plug-ins ~$86 · equipment GPS ~$85 · Bluetooth tool tags ~$20 — what we pay is what you pay.
              Yours to keep. Free pilots ship with loaner trackers.
            </p>
          </div>
          <div className="flex-none flex flex-col items-start sm:items-end gap-2">
            <Link href="/register" className="font-display font-bold text-sm rounded-xl px-4 py-2.5 bg-white/[0.04] border border-navy-700 text-ink hover:bg-white/[0.07] transition-colors">
              Start free pilot
            </Link>
            <a href={SALES_MAILTO} className="inline-flex items-center gap-1.5 text-xs text-faint hover:text-teal transition-colors">
              <Mail className="h-3 w-3" /> or email {SALES_EMAIL}
            </a>
          </div>
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

        {/* The wider field — the platforms behind the "compare fleet quotes"
            ads. Published/typical figures; honest about where they're strong. */}
        <section className="mt-12">
          <h3 className="font-display font-bold text-lg mb-2 text-center">How we compare across the board</h3>
          <p className="text-[12.5px] text-faint text-center max-w-xl mx-auto mb-5">
            The quote-comparison ads all lead to the same few platforms. Their published or
            typically-quoted terms, side by side with ours.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-navy-800">
            <table className="w-full text-[12.5px] min-w-[640px]">
              <thead>
                <tr className="bg-navy-900 text-left font-mono text-[10px] uppercase tracking-wide text-faint">
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3 text-amber">HammerTrack</th>
                  <th className="px-4 py-3">Tenna</th>
                  <th className="px-4 py-3">Samsara</th>
                  <th className="px-4 py-3">Verizon Connect</th>
                </tr>
              </thead>
              <tbody className="[&_td]:px-4 [&_td]:py-2.5 [&_tr]:border-t [&_tr]:border-navy-800">
                <tr className="bg-navy-950/60">
                  <td className="text-faint">Price per asset</td>
                  <td className="text-ink font-semibold">$8/machine · $3/tool tag</td>
                  <td className="text-muted">$15–25/mo</td>
                  <td className="text-muted">$20–40/mo</td>
                  <td className="text-muted">$20–35/mo</td>
                </tr>
                <tr>
                  <td className="text-faint">Setup fee</td>
                  <td className="text-ink font-semibold">$0</td>
                  <td className="text-muted">$500+</td>
                  <td className="text-muted">varies by quote</td>
                  <td className="text-muted">varies by quote</td>
                </tr>
                <tr className="bg-navy-950/60">
                  <td className="text-faint">Contract</td>
                  <td className="text-ink font-semibold">month-to-month</td>
                  <td className="text-muted">annual</td>
                  <td className="text-muted">multi-year, typically 3</td>
                  <td className="text-muted">multi-year</td>
                </tr>
                <tr>
                  <td className="text-faint">$20 Bluetooth tool tags</td>
                  <td className="text-teal font-semibold">✓ included in the model</td>
                  <td className="text-muted">paid add-on</td>
                  <td className="text-muted">—</td>
                  <td className="text-muted">—</td>
                </tr>
                <tr className="bg-navy-950/60">
                  <td className="text-faint">QuickBooks job costing</td>
                  <td className="text-teal font-semibold">✓ built in</td>
                  <td className="text-muted">enterprise only</td>
                  <td className="text-muted">via integrations</td>
                  <td className="text-muted">via integrations</td>
                </tr>
                <tr>
                  <td className="text-faint">Crew clock-in, daily logs, punch lists</td>
                  <td className="text-teal font-semibold">✓ same platform</td>
                  <td className="text-muted">—</td>
                  <td className="text-muted">—</td>
                  <td className="text-muted">—</td>
                </tr>
                <tr className="bg-navy-950/60">
                  <td className="text-faint">Built for</td>
                  <td className="text-ink font-semibold">contractors, by a contractor</td>
                  <td className="text-muted">enterprise construction</td>
                  <td className="text-muted">trucking &amp; logistics fleets</td>
                  <td className="text-muted">general fleets</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-faint text-center mt-3 max-w-2xl mx-auto">
            Fair&apos;s fair: if you need dashcams or DOT/ELD compliance for interstate trucking,
            Samsara and Verizon Connect are built for that — we&apos;re not. Competitor figures are
            their published or commonly quoted terms as of Aug 2026; always confirm your quote.
          </p>
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
