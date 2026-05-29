import Link from 'next/link'
import { Check, Map } from 'lucide-react'

const TIERS = [
  {
    name: 'Starter',
    price: '$3',
    unit: '/asset/mo',
    blurb: 'For small crews getting started.',
    cta: 'Start free trial',
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
    cta: 'Start free trial',
    highlight: true,
    features: [
      'Everything in Starter', 'QuickBooks integration', 'Maintenance & service records',
      'Utilization & job-site reports', 'Equipment usage billing', 'Unlimited assets', 'Priority support',
    ],
  },
  {
    name: 'Fleet',
    price: 'Custom',
    unit: '',
    blurb: 'For large fleets & multi-site.',
    cta: 'Contact us',
    highlight: false,
    features: [
      'Everything in Pro', 'Dedicated onboarding', 'Custom integrations',
      'SLA & phone support', 'Volume hardware pricing',
    ],
  },
]

const VS_TENNA = [
  ['$0 setup fees', 'Tenna: $500+ setup'],
  ['Bluetooth tools included', 'Tenna: paid add-on'],
  ['QuickBooks built in', 'Tenna: enterprise only'],
  ['Self-serve in minutes', 'Tenna: sales-led onboarding'],
  ['~$1–3/asset hardware data', 'Tenna: $15–25/asset/mo'],
]

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
            <Map className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold tracking-wider uppercase text-amber-400">HammerTrack</span>
        </Link>
        <Link href="/login" className="text-sm text-slate-300 hover:text-white">Sign in</Link>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-20">
        <div className="text-center py-10">
          <h1 className="text-3xl md:text-4xl font-bold">Asset tracking that pays for itself</h1>
          <p className="text-slate-400 mt-3 max-w-xl mx-auto">
            Everything Tenna does — vehicles, equipment, Bluetooth tools — at a fraction of the price, with QuickBooks built in.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {TIERS.map(tier => (
            <div
              key={tier.name}
              className={`rounded-2xl p-6 flex flex-col ${
                tier.highlight ? 'bg-white text-slate-900 ring-2 ring-amber-500 shadow-2xl' : 'bg-slate-800 text-white'
              }`}
            >
              {tier.highlight && (
                <span className="self-start bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full mb-2">
                  MOST POPULAR
                </span>
              )}
              <h2 className="text-lg font-bold">{tier.name}</h2>
              <p className={`text-sm mb-4 ${tier.highlight ? 'text-slate-500' : 'text-slate-400'}`}>{tier.blurb}</p>
              <div className="mb-4">
                <span className="text-3xl font-bold">{tier.price}</span>
                <span className={tier.highlight ? 'text-slate-500' : 'text-slate-400'}>{tier.unit}</span>
              </div>
              <ul className="space-y-2 flex-1">
                {tier.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className={`h-4 w-4 mt-0.5 flex-shrink-0 ${tier.highlight ? 'text-amber-500' : 'text-amber-400'}`} />
                    <span className={tier.highlight ? 'text-slate-700' : 'text-slate-300'}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={`mt-6 text-center font-semibold rounded-lg py-2.5 transition-colors ${
                  tier.highlight ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-700 text-white hover:bg-slate-600'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <section className="mt-12 bg-slate-800 rounded-2xl p-6">
          <h3 className="font-bold text-lg mb-4 text-center">Why contractors switch from Tenna</h3>
          <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
            {VS_TENNA.map(([us, them]) => (
              <div key={us} className="flex items-start gap-2">
                <Check className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-white">{us}</p>
                  <p className="text-xs text-slate-400 line-through">{them}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
