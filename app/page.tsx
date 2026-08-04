import Link from 'next/link'
import type { Metadata } from 'next'
import { MapPin, Bell, Wrench, Calculator, ShieldAlert, TrendingUp, ArrowRight, Users, Sparkles, Banknote, Package } from 'lucide-react'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { MapConsole } from '@/components/marketing/MapConsole'
import { FollowCinema } from '@/components/marketing/FollowCinema'
import { AnimatedHeadline } from '@/components/marketing/AnimatedHeadline'

export const metadata: Metadata = {
  title: 'HammerTrack — Mission control for your entire fleet',
  description:
    'Every truck, machine, and Bluetooth-tagged tool on one live map. HammerTrack alerts your phone the second something moves when it shouldn\'t. Half the price of Tenna, live in a day.',
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
    title: 'Utilization & safety insights',
    body: 'Daily miles and hours per machine, idle share, and an A–F driver-safety grade per truck — waste and abuse read at a glance.',
    tag: 'LIVE',
  },
]

const FEATURES = [
  { icon: MapPin, title: 'Whole fleet, one map', body: 'Trucks, heavy equipment, Bluetooth-tagged tools, and crews — live, with full replay of any day.' },
  { icon: ShieldAlert, title: 'After-hours theft alerts', body: 'A text the moment a machine moves off-hours or leaves the site — with the replay link as evidence.' },
  { icon: Users, title: 'Run the job on it', body: 'Punch lists, milestones, and budget burn per job site — plus crew clock-in and geofence-verified daily logs.' },
  { icon: Banknote, title: 'Books that keep themselves', body: 'QuickBooks two-way sync, live job cost, and a "snap the receipt?" ping seconds after a company card swipes.' },
  { icon: Wrench, title: 'A shop that stays ahead', body: 'Service intervals from real engine hours auto-open work orders — assign, track parts & labor, done.' },
  { icon: Calculator, title: 'Know what it all earns', body: 'Utilization and driver-safety grades per machine, margins vs your trade, and a live company valuation.' },
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
          <AnimatedHeadline />
          <p className="text-muted text-lg sm:text-[19px] mt-6 max-w-[56ch] mx-auto">
            HammerTrack puts every truck, employee, machine, trailer, and Bluetooth-tagged tool on
            one live map — and it alerts your phone the second something moves when it shouldn&apos;t.
            Half the price of competitors. Live in a day.
          </p>
          <p className="font-mono text-[12px] text-faint mt-4 tracking-wide">
            For any operation with vehicles, equipment &amp; tools in the field — from 5 assets to fleets of thousands
          </p>
          <div className="flex flex-col sm:flex-row gap-3.5 mt-7 justify-center">
            <Link
              href="/live"
              className="font-display font-bold text-[17px] rounded-xl px-7 py-4 bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors inline-flex items-center justify-center gap-2"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-[#1a1100]/70 animate-blink" /> See the live map <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/register"
              className="font-display font-bold rounded-xl px-6 py-3.5 bg-white/[0.03] border border-navy-700 text-ink hover:bg-white/[0.06] transition-colors inline-flex items-center justify-center"
            >
              Start free pilot
            </Link>
          </div>
          <p className="font-mono text-[13px] text-faint mt-3.5">
            Free 30 days · no credit card · we ship the trackers · cancel anytime
          </p>
        </section>

        {/* Follow-mode cinematic hero — self-contained 3D dark-topo flythrough */}
        <section className="max-w-5xl mx-auto px-6">
          <FollowCinema />
        </section>

        {/* Live activity console */}
        <section className="max-w-6xl mx-auto px-6 mt-6">
          <MapConsole />
          <p className="text-center font-mono text-[12.5px] text-faint mt-6 max-w-3xl mx-auto">
            We ship the trackers — plug-in OBD units for trucks, rugged GPS units for equipment &amp; Bluetooth tool tags. Built in South Carolina by a working contractor.
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

        {/* The ladder — cheap & simple in, whole company eventually (Brian, Aug 3) */}
        <section id="path" className="max-w-6xl mx-auto px-6 mt-16">
          <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-teal text-center">◇ Start simple. Grow when you&apos;re ready.</p>
          <h2 className="font-display font-extrabold text-[1.85rem] mt-2 text-center max-w-[30ch] mx-auto">
            From &ldquo;where&apos;s my excavator&rdquo; to running the whole company
          </h2>
          <p className="text-faint text-center mt-2 max-w-[58ch] mx-auto text-[14px]">
            Every tier is month-to-month with unlimited users and $0 setup. Start with theft
            protection for a few machines; turn on the rest when it earns its keep.
          </p>
          <div className="grid md:grid-cols-4 gap-4 mt-7">
            {[
              {
                step: '1', name: 'Track', price: '$8/machine · $3/tag', fee: '$0 platform fee',
                who: '“Just tell me where my stuff is.”',
                items: ['Live map + full replay', 'After-hours theft alerts', 'Geofenced job sites', 'Utilization reports'],
                hot: false,
              },
              {
                step: '2', name: 'Operate', price: 'adds $49/mo', fee: '25 tool tags included',
                who: '“Run my crews and jobs on it.”',
                items: ['Crew clock-in + daily logs', 'Punch lists, milestones, budgets', 'Maintenance → auto work orders', 'QuickBooks + receipt chase'],
                hot: true,
              },
              {
                step: '3', name: 'Run', price: 'talk to us', fee: '100 tags included',
                who: '“Run the company on it.”',
                items: ['AI assistant + owner digests', 'Driver safety grades', 'Who-ran-what attribution', 'API + exports'],
                hot: false,
              },
              {
                step: '4', name: 'Fully integrated', price: 'the endgame', fee: 'everything connected',
                who: 'The company runs itself on the data.',
                items: ['Factory feeds from Cat/Komatsu — no hardware', 'Margins vs your trade + live valuation', 'Estimates → invoices → paid (coming)', 'One system instead of five subscriptions'],
                hot: false,
              },
            ].map((t) => (
              <div key={t.name} className={`rounded-2xl border p-5 flex flex-col ${t.hot ? 'border-amber bg-amber/[0.06] shadow-glow-amber' : 'border-navy-800 bg-navy-900'}`}>
                <div className="flex items-center gap-2">
                  <span className={`grid place-items-center w-7 h-7 rounded-lg font-display font-black text-sm ${t.hot ? 'bg-amber text-[#1a1100]' : 'bg-navy-800 text-muted'}`}>{t.step}</span>
                  <h3 className="font-display font-extrabold text-lg">{t.name}</h3>
                  {t.hot && <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.08em] text-amber border border-amber/40 rounded-full px-2 py-0.5">most popular</span>}
                </div>
                <p className="font-display font-bold text-amber text-[15px] mt-2">{t.price}</p>
                <p className="font-mono text-[10.5px] text-faint">{t.fee}</p>
                <p className="text-[12.5px] text-muted italic mt-2">{t.who}</p>
                <ul className="mt-3 space-y-1.5 text-[12.5px] text-faint">
                  {t.items.map((i) => <li key={i} className="flex gap-1.5"><span className="text-teal">✓</span>{i}</li>)}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-center font-mono text-[12.5px] text-faint mt-5">
            Founding 25: <span className="text-amber">$6/machine + $3/tag with Operate included</span> — 12-month price lock, hardware at cost, cancel anytime. <Link href="/pricing" className="text-teal underline decoration-dotted">Full pricing →</Link>
          </p>
        </section>

        {/* Site IoT */}
        <section className="max-w-6xl mx-auto px-6 mt-16">
          <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-teal text-center">◇ Beyond tracking · <span className="text-amber">on the roadmap</span></p>
          <h2 className="font-display font-extrabold text-[1.85rem] mt-2 text-center max-w-[26ch] mx-auto">Your whole jobsite on one map — not just what moves</h2>
          <p className="text-faint text-center mt-2 max-w-[54ch] mx-auto text-[14px]">
            Where we&rsquo;re headed: cameras, fuel tanks, generators, pumps, and an on-site weather station — live on the same map as your fleet. One pane of glass for the entire site. <span className="text-muted">(Live weather is shipping today; the rest is coming.)</span>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-7">
            {[
              { e: '📷', t: 'Site cameras', d: 'Gate + perimeter feeds pinned right on the map.' },
              { e: '⛽', t: 'Fuel tank levels', d: 'Diesel & genset fill %, with low-fuel alerts.' },
              { e: '⚡', t: 'Generators & pumps', d: 'Runtime, fuel, and dewatering flow at a glance.' },
              { e: '🌤️', t: 'Weather station', d: 'Real on-site temp, wind & rain — not just a forecast.' },
            ].map(({ e, t, d }) => (
              <div key={t} className="bg-navy-900 border border-navy-800 rounded-2xl p-5">
                <div className="text-2xl mb-2">{e}</div>
                <h3 className="font-display font-bold text-[15px]">{t}</h3>
                <p className="text-[13px] text-faint mt-1">{d}</p>
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

        {/* Founder note — built by the customer, not a telematics giant */}
        <section className="max-w-3xl mx-auto px-6 mt-16">
          <div className="rounded-2xl border border-navy-800 bg-navy-900 p-8 text-center relative overflow-hidden">
            <div className="absolute inset-0 brand-glow" />
            <div className="relative">
              <p className="font-display text-[1.35rem] font-bold leading-snug text-ink max-w-[38ch] mx-auto">
                &ldquo;I run crews and equipment every day. I built HammerTrack because the big
                telematics platforms wanted $500 setup and $20 a machine to tell me where my own
                excavator was.&rdquo;
              </p>
              <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-faint mt-4">
                — Founder · working contractor, South Carolina
              </p>
            </div>
          </div>
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
