import Link from 'next/link'
import type { Metadata } from 'next'
import { MapPin, Bell, Wrench, Calculator, ShieldAlert, TrendingUp, ArrowRight, Users, Sparkles, Banknote, Package } from 'lucide-react'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { RealCinema } from '@/components/marketing/RealCinema'
import { RoiCalculator } from '@/components/marketing/RoiCalculator'

export const metadata: Metadata = {
  title: 'HammerTrack — Know where every truck, machine, crew & tool is. Right now.',
  description:
    'Built by a contractor, running on his own fleet. Live GPS + job-site zones, exact hours banked automatically, an AI you can ask anything, and a text within minutes when something moves at 2 AM. About half the price of Tenna, live in a day.',
}

const AI = [
  {
    icon: ShieldAlert,
    title: 'After-hours watchdog',
    body: 'Your yard has been quiet since 6 PM. Something moves at 2 AM — your phone knows by 2:09 — then replay the whole route on the map.',
    tag: 'LIVE',
  },
  {
    icon: Wrench,
    title: 'Service that tracks itself',
    body: 'Real engine hours open the work order the moment service goes overdue — not after the machine is down.',
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
  { icon: ShieldAlert, title: 'After-hours theft alerts', body: 'A text the moment a machine moves off-hours or leaves the site — then replay the whole route as evidence.' },
  { icon: Users, title: 'Run the job on it', body: 'Punch lists, milestones, and budget burn per job site — plus crew clock-in and zone-verified daily logs.' },
  { icon: Banknote, title: 'Books that keep themselves', body: 'QuickBooks job-cost sync, live budget burn per site, and a "snap the receipt?" ping seconds after a company card swipes.' },
  { icon: Wrench, title: 'A shop that stays ahead', body: 'Service intervals from real engine hours auto-open work orders — assign, track parts & labor, done.' },
  { icon: Calculator, title: 'Know what it all earns', body: 'Utilization and driver-safety grades per machine, margins vs your trade, and a live company valuation.' },
]

// Ladder bullets: strings are shipped features (✓); `roadmap: true` renders
// the ROADMAP badge instead — never a ✓ on an unshipped item (splash truth rule).
type LadderItem = string | { t: string; roadmap: true }

const PRICE = [
  { k: '$0', v: 'setup — Tenna charges $500+' },
  { k: '$8 + $3', v: '/machine + /tool tag per mo — Tenna is $15–25/asset' },
  { k: '1 day', v: 'to live — no install crew' },
  { k: 'AI', v: 'included — not an enterprise tier' },
]

export default function HomePage() {
  return (
    <div className="relative min-h-screen bg-navy-950 text-ink font-sans">
      <div className="fixed inset-0 z-0 pointer-events-none brand-glow" />
      <SiteNav />

      <main className="relative z-10">
        {/* Hero — identity first, outcome headline, proof one scroll-inch away
            (the REAL map engine below, never a mockup — splash truth rule). */}
        <section className="max-w-3xl mx-auto px-6 pt-14 pb-8 text-center">
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-teal font-semibold">
            Built by a contractor, running on his own fleet
          </p>
          <h1 className="font-display font-black text-[2.6rem] sm:text-[3.7rem] leading-[1.02] tracking-tight mt-4 text-balance">
            Know where every truck, machine, crew, and tool is —
            <span className="text-amber"> right now.</span>
          </h1>
          <p className="text-muted text-lg sm:text-[19px] mt-6 max-w-[58ch] mx-auto">
            Live GPS and job-site zones across the fleet, the crews, and the Bluetooth-tagged tools.
            Exact job-site hours banked automatically. An AI you can ask anything about the
            operation. And when a machine moves at 2 AM, your phone knows in minutes.
          </p>
          <p className="font-mono text-[12px] text-faint mt-4 tracking-wide">
            About half the price of Tenna, with $0 setup · live in a day · from 5 assets up
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
            Founding 25 — first 25 companies: free 30-day pilot · hardware ships in
            batches, a refundable deposit holds yours · founder pricing locked · cancel anytime
          </p>
        </section>

        {/* Follow-mode cinematic — the REAL map engine on real satellite tiles,
            so the hero shows exactly what a customer gets (Brian, Aug 3). */}
        <section className="max-w-5xl mx-auto px-6">
          <RealCinema />
        </section>

        {/* (The old CSS-mock "console" is gone — it faked a product screen.
            RealCinema above IS the real engine, and /live is one tap away.
            Nothing on this page may depict functionality that doesn't exist —
            splash truth rule, Brian, Aug 5.) */}
        <section className="max-w-6xl mx-auto px-6 mt-6">
          <p className="text-center font-mono text-[12.5px] text-faint max-w-3xl mx-auto">
            That&apos;s the real map engine above — and the <Link href="/live" className="text-teal underline decoration-dotted">live demo</Link> is
            the real product. Hardware is the boring part: we ship plug-in trackers at cost, powered on in minutes.
          </p>
        </section>

        {/* The 2 AM story — the theft hook told as a timeline, not adjectives.
            Every beat is a shipped feature; the proof line is a production
            event on our own fleet (Aug 2026). */}
        <section className="max-w-6xl mx-auto px-6 mt-16">
          <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-alert text-center">◇ The night it pays for itself</p>
          <h2 className="font-display font-extrabold text-[1.85rem] mt-2 text-center max-w-[28ch] mx-auto">
            Your excavator leaves the yard at 2:07 AM. Here&apos;s the next half hour.
          </h2>
          <div className="grid sm:grid-cols-3 gap-4 mt-8 relative">
            {[
              {
                t: '2:07 AM', tone: 'alert' as const, title: 'It starts moving',
                body: 'The yard zone has been quiet since 6 PM. A tracked excavator crosses the line doing 14 mph on a trailer.',
              },
              {
                t: '2:09 AM', tone: 'amber' as const, title: 'Your phone buzzes',
                body: '“THEFT ALERT — Excavator left Yard after hours.” Live pin and direction of travel as a text — then replay the whole route on the map.',
              },
              {
                t: '2:31 AM', tone: 'teal' as const, title: 'You call it in with a location',
                body: 'You hand dispatch a live position and a replay of the whole route. That’s a recovery in progress — not an insurance claim and a 6-month premium hike.',
              },
            ].map((s) => (
              <div key={s.t} className={`rounded-2xl border p-6 bg-navy-900 ${
                s.tone === 'alert' ? 'border-alert/40' : s.tone === 'amber' ? 'border-amber/40' : 'border-teal/40'
              }`}>
                <p className={`font-mono font-bold text-[13px] tabular-nums ${
                  s.tone === 'alert' ? 'text-alert' : s.tone === 'amber' ? 'text-amber' : 'text-teal'
                }`}>{s.t}</p>
                <h3 className="font-display font-extrabold text-base mt-1.5">{s.title}</h3>
                <p className="text-[13.5px] text-faint mt-1.5">{s.body}</p>
              </div>
            ))}
          </div>
          <p className="text-center font-mono text-[12px] text-faint mt-5 max-w-2xl mx-auto">
            Not a mockup: after-hours alerts run in production on our own fleet — movement to
            text in under two minutes. Theft is the night it pays for itself; knowing where
            everything is at 2 PM is why it earns its keep every day.
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
                  {tag === 'LIVE' ? (
                    // LIVE tag = a door, not a badge: straight into the map.
                    // Outer link is a ≥44px hit area (padding + negative margin);
                    // the inner span keeps the chip's visual size unchanged.
                    <Link href="/live" className="group/live inline-flex items-center mt-1 -mb-2.5 -ml-1.5 py-3 px-1.5">
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-amber border border-amber/30 rounded-md px-1.5 py-0.5 group-hover/live:bg-amber/10 transition-colors">
                        <span className="w-1 h-1 rounded-full bg-amber animate-blink" /> LIVE — see it on the map
                      </span>
                    </Link>
                  ) : (
                    <span className="inline-block mt-2.5 font-mono text-[10px] text-amber border border-amber/30 rounded-md px-1.5 py-0.5">
                      {tag}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Make the AI tangible: real questions the assistant answers from
                live fleet data, shown with demo-fleet answers. */}
            <div className="mt-7">
              <p className="font-mono text-[11.5px] text-faint mb-3">Ask it like you&apos;d ask your best superintendent — and the kind of answer you get back (illustrative examples):</p>
              <div className="grid md:grid-cols-3 gap-4">
                {[
                  {
                    q: 'Which machine sat idle the most this week?',
                    a: 'The Sakai SW990 — 26 idle hours against 4 working. It hasn’t left Creekside since Tuesday.',
                  },
                  {
                    q: 'Who was on the Riverside site yesterday, and how long?',
                    a: 'Three crew and the RAM 3500. Two full days (7:02 AM–3:41 PM), one half day, truck on site 6.9 hours.',
                  },
                  {
                    q: 'Did anyone report safety issues this week?',
                    a: 'One — Thursday’s daily log flagged a frayed sling on the Link-Belt. It paged the owner the moment it was submitted.',
                  },
                ].map(({ q, a }) => (
                  <div key={q} className="rounded-xl border border-navy-800 bg-navy-950 p-4">
                    <p className="text-[13px] font-semibold text-ink">“{q}”</p>
                    <p className="text-[12.5px] text-teal mt-2 border-l-2 border-teal/40 pl-2.5">{a}</p>
                  </div>
                ))}
              </div>
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
              { n: '3', icon: Bell, title: 'It watches and warns', body: 'After-hours theft texts, zone-verified hours, and live job cost — automatically, the moment something moves.' },
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
                items: ['Live map + full replay', 'After-hours theft alerts', 'Job-site & yard zones', 'Utilization reports'],
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
                items: ['AI assistant + owner digests', 'Driver safety grades', { t: 'Who-ran-what attribution', roadmap: true }, 'API + exports'] as LadderItem[],
                hot: false,
              },
              {
                step: '4', name: 'Fully integrated', price: 'the endgame', fee: 'everything connected',
                who: 'The company runs itself on the data.',
                items: ['Factory feeds from Cat/Komatsu — no hardware', 'Margins vs your trade + live valuation', { t: 'Estimates → invoices → paid', roadmap: true }, 'One system instead of five subscriptions'] as LadderItem[],
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
                  {(t.items as LadderItem[]).map((raw) => {
                    const i = typeof raw === 'string' ? { t: raw, roadmap: false } : raw
                    return (
                      <li key={i.t} className="flex items-start gap-1.5">
                        {i.roadmap ? (
                          <span className="flex-none font-mono text-[9px] uppercase tracking-wide text-faint border border-navy-700 rounded-md px-1 py-px mt-0.5">Roadmap</span>
                        ) : (
                          <span className="text-teal">✓</span>
                        )}
                        <span>{i.t}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-center font-mono text-[12.5px] text-faint mt-5">
            Founding 25: <span className="text-amber">$6/machine + $3/tag with Operate included</span> — 12-month price lock, hardware at cost, cancel anytime. <Link href="/pricing" className="inline-block text-teal underline decoration-dotted whitespace-nowrap py-3.5 -my-3.5 px-1 -mx-1">Full pricing&nbsp;→</Link>
          </p>
        </section>

        {/* ROI calculator — price anchoring with published numbers only */}
        <section className="max-w-4xl mx-auto px-6 mt-16">
          <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-teal text-center">◇ Run your own numbers</p>
          <h2 className="font-display font-extrabold text-[1.85rem] mt-2 text-center">What your fleet costs here vs. Tenna</h2>
          <div className="mt-7">
            <RoiCalculator />
          </div>
        </section>

        {/* Site IoT */}
        <section className="max-w-6xl mx-auto px-6 mt-16">
          <p className="font-mono text-[12px] uppercase tracking-[0.1em] text-teal text-center">◇ Beyond tracking · <span className="text-teal">live today</span> + <span className="text-amber">roadmap</span></p>
          <h2 className="font-display font-extrabold text-[1.85rem] mt-2 text-center max-w-[26ch] mx-auto">Your whole jobsite on one map — not just what moves</h2>
          <p className="text-faint text-center mt-2 max-w-[54ch] mx-auto text-[14px]">
            Already live: your own on-site weather station, public webcams, live radar and
            per-site forecasts — on the same map as your fleet. Coming next: your own gate
            cameras, fuel tank levels, generators &amp; pumps.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-7">
            {[
              { e: '🌤️', t: 'Weather station', d: 'Your Ambient/Tempest/WU station live on the map — real on-site temp, wind & rain.', live: true },
              { e: '📷', t: 'Webcams', d: 'Public traffic & area cams around your sites, pinned on the map — tap for the picture.', live: true },
              { e: '⛽', t: 'Fuel tank levels', d: 'Diesel & genset fill %, with low-fuel alerts.', live: false },
              { e: '⚡', t: 'Generators & pumps', d: 'Runtime, fuel, and dewatering flow at a glance.', live: false },
            ].map(({ e, t, d, live }) => (
              <div key={t} className="bg-navy-900 border border-navy-800 rounded-2xl p-5">
                <div className="text-2xl mb-2">{e}</div>
                <h3 className="font-display font-bold text-[15px]">{t}</h3>
                <p className="text-[13px] text-faint mt-1">{d}</p>
                {live ? (
                  <span className="inline-flex items-center gap-1 mt-2.5 font-mono text-[10px] text-teal border border-teal/30 rounded-md px-1.5 py-0.5">
                    <span className="w-1 h-1 rounded-full bg-teal animate-blink" /> LIVE
                  </span>
                ) : (
                  <span className="inline-block mt-2.5 font-mono text-[10px] text-faint border border-navy-700 rounded-md px-1.5 py-0.5">
                    ROADMAP
                  </span>
                )}
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
            Same fleet visibility as the big guys. About half the price.
          </p>
        </section>

        {/* Founder note — built by the customer, not a telematics giant.
            This is the moat: lean into it hard (Brian, Aug 9). */}
        <section className="max-w-3xl mx-auto px-6 mt-16">
          <div className="rounded-2xl border border-navy-800 bg-navy-900 p-8 text-center relative overflow-hidden">
            <div className="absolute inset-0 brand-glow" />
            <div className="relative">
              <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-amber">Built by a contractor, on his own fleet</p>
              <p className="font-display text-[1.35rem] font-bold leading-snug text-ink max-w-[38ch] mx-auto mt-3">
                &ldquo;I run crews and equipment every day. I built HammerTrack because the big
                telematics platforms wanted $500 setup and $20 a machine to tell me where my own
                excavator was.&rdquo;
              </p>
              <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-faint mt-4">
                — Brian, founder · working contractor, Greenville, South Carolina
              </p>
              <p className="text-[14px] text-muted max-w-[52ch] mx-auto mt-5">
                HammerTrack runs on a working construction company&apos;s own trucks, excavators, and
                tool trailers first. Every feature on this page shipped because a real crew needed
                it that week — not because a product manager in an office tower guessed. The big
                platforms build for fleet-manager dashboards; this is built for whoever loads the
                trailer at 6 AM.
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
