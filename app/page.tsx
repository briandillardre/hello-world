import Link from 'next/link'
import type { Metadata } from 'next'
import { MapPin, Bell, Wrench, Calculator, ShieldAlert, TrendingUp, ArrowRight, Users, Sparkles, Banknote, Package } from 'lucide-react'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { MapConsole } from '@/components/marketing/MapConsole'

export const metadata: Metadata = {
  title: 'HammerTrack — Mission control for your entire fleet',
  description:
    'Every truck, machine, and Bluetooth-tagged tool on one live map. Our AI texts you the second something moves when it shouldn\'t. Half the price of Tenna, live in a day.',
}

const AI = [
  {
    icon: ShieldAlert,
    title: 'Anomaly detection',
    body: "Learns each machine's normal day, then flags the 2 AM move, the off-site drift, the route that's wrong.",
    tag: 'LIVE',
  },
  {
    icon: Wrench,
    title: 'Predictive maintenance',
    body: 'Watches real engine hours and usage to call service before a breakdown costs you a workday.',
    tag: 'LIVE',
  },
  {
    icon: Sparkles,
    title: 'Ask your fleet',
    body: '"Who\'s at Maple St? What\'s it cost today?" Plain-English answers from your live data.',
    tag: 'LIVE',
  },
  {
    icon: TrendingUp,
    title: 'Utilization insights',
    body: "Spots the idle machine you're paying for and the job that's eating equipment cost — in plain English.",
    tag: 'ROADMAP',
  },
]

const FEATURES = [
  { icon: MapPin, title: 'Whole fleet, one map', body: 'Trucks, heavy equipment, and Bluetooth-tagged tools — live and clustered.' },
  { icon: ShieldAlert, title: 'After-hours theft alerts', body: 'A text the moment a machine moves off-hours or leaves the site.' },
  { icon: Users, title: 'Track crews, not just machines', body: 'Phone clock-in with GPS that follows the crew all shift — people and equipment on one map.' },
  { icon: Banknote, title: 'Live job-site cost', body: 'Watch labor + equipment dollars stack up on each job in real time, against budget.' },
  { icon: Wrench, title: 'Maintenance built in', body: 'Service by engine hours, mileage, or days. Never miss an oil change.' },
  { icon: Calculator, title: 'QuickBooks native', body: 'Auto-allocate equipment cost to jobs and bill usage automatically.' },
]

const PRICE = [
  { k: '$0', v: 'setup — Tenna charges $500+' },
  { k: '~$3–8', v: '/asset/mo — Tenna is $15–25' },
  { k: '1 day', v: 'to live — no install crew' },
  { k: 'AI', v: 'included — not an enterprise tier' },
]

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-navy-950 text-ink font-sans">
      <div className="fixed inset-0 z-0 pointer-events-none brand-glow" />
      <SiteNav />

      <main className="relative z-10">
        {/* Hero */}
        <section className="max-w-3xl mx-auto px-6 pt-14 pb-8 text-center">
          <span className="inline-flex items-center gap-2.5 bg-teal/[0.08] border border-teal/25 text-teal px-4 py-1.5 rounded-full font-mono text-[12px] font-semibold uppercase tracking-[0.08em]">
            <span className="w-[7px] h-[7px] rounded-full bg-teal shadow-glow-teal animate-blink" />
            AI watching 38 assets · 2 sites · live now
          </span>
          <h1 className="font-display font-black text-[2.6rem] sm:text-[3.9rem] leading-[1.0] tracking-tight mt-6 text-balance">
            Your $80K excavator just left at 2 AM.{' '}
            <span className="text-amber">You already got the text.</span>
          </h1>
          <p className="text-muted text-lg sm:text-[19px] mt-6 max-w-[56ch] mx-auto">
            HammerTrack puts every truck, machine, and Bluetooth-tagged tool on one live map — and
            our AI texts you the second something moves when it shouldn&apos;t. Half the price of
            Tenna. Live in a day.
          </p>
          <p className="font-mono text-[12px] text-faint mt-4 tracking-wide">
            For contractors, excavation, grading &amp; site crews — 5 to 500 assets
          </p>
          <div className="flex flex-col sm:flex-row gap-3.5 mt-7 justify-center">
            <Link
              href="/map"
              className="font-display font-bold text-[17px] rounded-xl px-7 py-4 bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors inline-flex items-center justify-center gap-2"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#1a1100]/70 animate-blink" /> See the live map <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/register"
              className="font-display font-bold rounded-xl px-6 py-3.5 bg-white/[0.03] border border-navy-700 text-ink hover:bg-white/[0.06] transition-colors inline-flex items-center justify-center"
            >
              Start free 30-day pilot
            </Link>
          </div>
          <p className="font-mono text-[13px] text-faint mt-3.5">
            No credit card · we ship the trackers · cancel anytime
          </p>
        </section>

        {/* Map console hero */}
        <section className="max-w-6xl mx-auto px-6">
          <MapConsole />
          <p className="text-center font-mono text-[12.5px] text-faint mt-6 max-w-3xl mx-auto">
            We ship the trackers — Teltonika GPS, OBD2 plug-ins &amp; BlueCharm Bluetooth tags. Built in Nashville for working contractors.
          </p>
        </section>

        {/* AI band */}
        <section id="ai" className="max-w-6xl mx-auto px-6 mt-16">
          <div className="rounded-2xl p-8 sm:p-9 border border-navy-800 bg-gradient-to-br from-teal/[0.07] to-amber/[0.05]">
            <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-teal">◇ The AI layer</p>
            <h2 className="font-display font-extrabold text-[1.85rem] mt-2 max-w-[24ch]">
              It doesn&apos;t just track. It watches, learns, and warns.
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              {AI.map(({ icon: Icon, title, body, tag }) => (
                <div key={title} className="bg-navy-900 border border-navy-800 rounded-xl p-5">
                  <div className="w-[38px] h-[38px] rounded-[10px] bg-teal/10 border border-teal/20 grid place-items-center mb-3.5">
                    <Icon className="h-[19px] w-[19px] text-teal" />
                  </div>
                  <h3 className="font-display font-bold text-[15px]">{title}</h3>
                  <p className="text-[13px] text-faint mt-1.5">{body}</p>
                  <span className="inline-block mt-2.5 font-mono text-[10px] text-amber border border-amber/30 rounded-md px-1.5 py-0.5">
                    {tag}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-6xl mx-auto px-6 mt-16">
          <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-teal text-center">◇ Live in a day</p>
          <h2 className="font-display font-extrabold text-[1.85rem] mt-2 text-center">Three steps. No install crew.</h2>
          <div className="grid sm:grid-cols-3 gap-4 mt-7">
            {[
              { n: '1', icon: Package, title: 'We ship the trackers', body: 'Plug the OBD2 into trucks, drop a GPS on equipment, stick a Bluetooth tag on tools. Crews clock in from their phones.' },
              { n: '2', icon: MapPin, title: 'Everything appears on your map', body: 'Trucks, machines, tools, and people show up live within minutes of powering on — no IT, no setup crew.' },
              { n: '3', icon: Bell, title: 'It watches and warns', body: 'After-hours theft texts, geofence-verified hours, and live job cost — automatically, the moment something moves.' },
            ].map(({ n, icon: Icon, title, body }) => (
              <div key={n} className="bg-navy-900 border border-navy-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-3.5">
                  <span className="grid place-items-center w-8 h-8 rounded-lg bg-amber/15 text-amber font-display font-black">{n}</span>
                  <Icon className="h-5 w-5 text-teal" />
                </div>
                <h3 className="font-display font-bold text-base">{title}</h3>
                <p className="text-[13.5px] text-faint mt-1.5">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-6 py-14">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-navy-900 border border-navy-800 rounded-2xl p-6">
                <div className="w-[42px] h-[42px] rounded-xl bg-amber/[0.13] grid place-items-center mb-4">
                  <Icon className="h-[21px] w-[21px] text-amber" />
                </div>
                <h3 className="font-display font-extrabold text-base">{title}</h3>
                <p className="text-[13.5px] text-faint mt-1.5">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Price strip */}
        <section className="max-w-6xl mx-auto px-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-navy-800 border border-navy-800 rounded-2xl overflow-hidden">
            {PRICE.map(({ k, v }) => (
              <div key={v} className="bg-navy-900 p-6">
                <div className="font-display font-black text-[2rem] text-amber">{k}</div>
                <div className="text-[12.5px] text-faint mt-1">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-center font-mono text-[13px] text-faint mt-5">
            Same fleet visibility as the big guys. A fraction of the price.
          </p>
        </section>

        {/* Final CTA */}
        <section className="max-w-5xl mx-auto px-6 py-16">
          <div className="rounded-3xl border border-navy-800 bg-gradient-to-br from-navy-900 to-navy-950 p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 brand-glow" />
            <div className="relative">
              <Bell className="h-8 w-8 mx-auto mb-3 text-amber" />
              <h2 className="font-display font-black text-[1.9rem]">Stop guessing where your gear is.</h2>
              <p className="text-muted mt-2 max-w-xl mx-auto">
                Start a free 30-day pilot. We ship you 5 trackers — put your whole site on the map.
              </p>
              <Link
                href="/register"
                className="inline-flex items-center justify-center gap-2 font-display font-bold rounded-xl px-8 py-3.5 mt-6 bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors"
              >
                Start free pilot <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
