import Link from 'next/link'
import type { Metadata } from 'next'
import { Check, MapPin, Bell, Wrench, Calculator, ShieldAlert, ArrowRight } from 'lucide-react'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { DemoCinemaLoader } from '@/components/marketing/DemoCinemaLoader'
import { Reveal } from '@/components/ui/reveal'
import { CountUp } from '@/components/ui/count-up'

export const metadata: Metadata = {
  title: 'HammerTrack — Know where every truck, machine & tool is. Right now.',
  description:
    'Put your whole fleet on one map and get a text the second something moves when it shouldn\'t. Half the price of the big telematics platforms, set up in a day. Start a free pilot.',
}

const FEATURES = [
  { icon: MapPin, title: 'Whole fleet, one map', body: 'Trucks, heavy equipment, and Bluetooth-tagged tools — live, clustered, mobile-first.' },
  { icon: ShieldAlert, title: 'After-hours theft alerts', body: 'Get a text the moment a machine moves outside work hours or leaves the jobsite.' },
  { icon: Wrench, title: 'Maintenance built in', body: 'Service schedules by engine hours, mileage, or days. Never miss an oil change again.' },
  { icon: Calculator, title: 'QuickBooks native', body: 'Auto-allocate equipment cost to job sites and bill usage. Your CFO will love you.' },
]

const VS_TENNA = [
  ['$0 setup fees', 'Tenna: $500+ setup'],
  ['Bluetooth tools included', 'Tenna: paid add-on'],
  ['QuickBooks built in', 'Tenna: enterprise only'],
  ['~$3–8 / asset / mo', 'Tenna: $15–25 / asset / mo'],
]

const SALES_PHONE = '864-915-2351'
const SALES_TEL = 'tel:+18649152351'

export default function DemoLandingPage() {
  return (
    <div className="relative min-h-screen bg-navy-950 text-ink font-sans">
      <div className="fixed inset-0 z-0 pointer-events-none brand-glow" />
      <SiteNav />

      <main className="relative z-10">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-8 pb-12 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-2 bg-alert/10 text-alert border border-alert/30 px-3 py-1 rounded-full text-xs font-bold font-mono">
              <span className="w-[7px] h-[7px] rounded-full bg-alert animate-pulse-ring" /> THEFT ALERT — Skid Steer #3 moved at 2:14 AM
            </span>
            <h1 className="font-display font-black text-[2.4rem] md:text-5xl leading-[1.04] mt-5 text-balance">
              Your $80K excavator just left the jobsite at 2 AM.
              <span className="text-amber"> Would you know?</span>
            </h1>
            <p className="text-muted mt-5 text-lg">
              HammerTrack puts every truck, machine, and power tool on one live map — and our AI texts you
              the second something moves when it shouldn&apos;t. Half the price of the big telematics
              platforms. Set up in a day, no install crew.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 mt-8">
              <Link
                href="/register"
                className="bg-amber hover:bg-amber-600 text-[#1a1100] font-display font-bold rounded-xl px-6 py-3.5 text-center inline-flex items-center justify-center gap-2 shadow-glow-amber transition-colors"
              >
                Start free pilot <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/map"
                className="bg-white/[0.03] hover:bg-white/[0.06] text-ink font-display font-bold rounded-xl px-6 py-3.5 text-center border border-navy-700 transition-colors"
              >
                See the live demo →
              </Link>
            </div>
            <p className="font-mono text-xs text-faint mt-3">No credit card. We ship the trackers. Cancel anytime.</p>
            <p className="text-sm text-muted mt-3">
              Rather talk it through? Call/text <a href={SALES_TEL} className="text-amber font-semibold hover:underline">{SALES_PHONE}</a>.
            </p>
          </div>

          {/* Cinematic theater: satellite fly-around + the 2:14 AM story, on loop */}
          <DemoCinemaLoader />
        </section>

        {/* Numbers band */}
        <section className="border-y border-navy-800 bg-navy-900/40">
          <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-3 gap-4 text-center">
            <Reveal>
              <p className="font-display font-black text-2xl md:text-4xl text-amber">
                <CountUp value={2} prefix="" suffix=" min" />
              </p>
              <p className="text-xs md:text-sm text-faint mt-1">from movement to text alert</p>
            </Reveal>
            <Reveal delay={120}>
              <p className="font-display font-black text-2xl md:text-4xl text-teal">
                <CountUp value={60} suffix="%" />
              </p>
              <p className="text-xs md:text-sm text-faint mt-1">cheaper than Tenna, no setup fee</p>
            </Reveal>
            <Reveal delay={240}>
              <p className="font-display font-black text-2xl md:text-4xl text-ink">
                <CountUp value={1} suffix=" day" />
              </p>
              <p className="text-xs md:text-sm text-faint mt-1">to put your whole fleet on the map</p>
            </Reveal>
          </div>
        </section>

        {/* Features */}
        <section className="max-w-6xl mx-auto px-6 py-10">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map(({ icon: Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 90}>
                <div className="bg-navy-900 rounded-2xl p-5 border border-navy-800 h-full">
                  <div className="w-10 h-10 rounded-lg bg-amber/[0.15] flex items-center justify-center mb-3">
                    <Icon className="h-5 w-5 text-amber" />
                  </div>
                  <h3 className="font-display font-bold">{title}</h3>
                  <p className="text-sm text-faint mt-1">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* vs Tenna */}
        <section className="max-w-3xl mx-auto px-6 py-8">
          <Reveal>
            <h2 className="font-display font-bold text-2xl text-center mb-6">Why contractors switch from Tenna</h2>
          </Reveal>
          <div className="grid sm:grid-cols-2 gap-3">
            {VS_TENNA.map(([us, them], i) => (
              <Reveal key={us} delay={i * 80}>
                <div className="flex items-start gap-2 bg-navy-900/60 rounded-xl px-4 py-3 border border-navy-800 h-full">
                  <Check className="h-5 w-5 text-teal flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-ink">{us}</p>
                    <p className="text-xs text-faint line-through">{them}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Founding 25 offer — mirrors the printed sales sheet */}
        <section className="max-w-3xl mx-auto px-6 py-8">
          <Reveal>
            <div className="relative rounded-3xl border-2 border-amber bg-gradient-to-br from-amber/[0.12] to-transparent p-7 sm:p-9">
              <span className="absolute -top-3 left-7 bg-amber text-[#3a2200] font-mono text-[11px] font-bold uppercase tracking-[0.08em] px-3 py-1 rounded-full">Founding 25 · limited</span>
              <h2 className="font-display font-black text-2xl sm:text-3xl text-ink mt-2">
                $99/mo flat — up to 25 assets, <span className="text-amber">price locked 2 years</span>
              </h2>
              <p className="text-muted mt-2">Be one of our first 25 fleets. Lock this rate while we grow — it never goes up on you.</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
                {['Free 30-day pilot', 'We ship & pre-set the trackers', 'Live on your map in a day', 'Cancel anytime'].map((t) => (
                  <span key={t} className="flex items-center gap-2 text-sm text-ink"><Check className="h-4 w-4 text-teal" /> {t}</span>
                ))}
              </div>
              <Link href="/register" className="inline-flex items-center justify-center gap-2 bg-amber hover:bg-amber-600 text-[#1a1100] font-display font-bold rounded-xl px-6 py-3.5 mt-6 shadow-glow-amber transition-colors">
                Claim a founding spot <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </section>

        {/* Final CTA */}
        <section className="max-w-5xl mx-auto px-6 py-16 text-center">
          <Reveal>
            <div className="bg-gradient-to-br from-amber to-amber-600 rounded-3xl p-10 text-[#1a1100]">
              <Bell className="h-8 w-8 mx-auto mb-3" />
              <h2 className="font-display font-black text-3xl">Stop guessing where your gear is.</h2>
              <p className="mt-2 max-w-xl mx-auto opacity-90">
                Start a free 30-day pilot. We ship you 5 trackers, you put your whole site on the map.
              </p>
              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-2 bg-navy-950 text-ink font-display font-bold rounded-xl px-8 py-3.5 mt-6 hover:bg-navy-900 transition-colors"
              >
                Start free pilot <ArrowRight className="h-4 w-4" />
              </Link>
              <p className="text-sm mt-4 opacity-80">
                Or call/text <a href={SALES_TEL} className="font-semibold underline">{SALES_PHONE}</a> — real person, no call center.
              </p>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
