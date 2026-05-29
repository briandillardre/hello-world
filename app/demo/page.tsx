import Link from 'next/link'
import type { Metadata } from 'next'
import { Check, MapPin, Bell, Wrench, Calculator, ShieldAlert, ArrowRight } from 'lucide-react'

export const metadata: Metadata = {
  title: 'HammerTrack — Know where every truck, machine & tool is. Right now.',
  description:
    'Put your whole fleet on one map and get a text the second something moves when it shouldn\'t. Half the price of Tenna, set up in a day. Start a free 30-day pilot.',
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

export default function DemoLandingPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Nav */}
      <header className="max-w-5xl mx-auto px-4 py-6 flex items-center justify-between">
        <Link href="/demo" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
            <MapPin className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold tracking-wider uppercase text-amber-400">HammerTrack</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">Pricing</Link>
          <Link href="/login" className="text-sm text-slate-300 hover:text-white">Sign in</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-4 pt-8 pb-16 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <span className="inline-flex items-center gap-2 bg-red-500/10 text-red-300 border border-red-500/30 px-3 py-1 rounded-full text-xs font-bold">
            <ShieldAlert className="h-3.5 w-3.5" /> THEFT ALERT — Skid Steer #3 moved at 2:14 AM
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold leading-tight mt-5">
            Your $80K excavator just left the jobsite at 2 AM.
            <span className="text-amber-400"> Would you know?</span>
          </h1>
          <p className="text-slate-300 mt-5 text-lg">
            HammerTrack puts every truck, machine, and power tool on one map — and texts you
            the second something moves when it shouldn&apos;t. Half the price of Tenna.
            Set up in a day, no install crew.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 mt-8">
            <Link
              href="/register"
              className="bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl px-6 py-3.5 text-center inline-flex items-center justify-center gap-2 transition-colors"
            >
              Start Free 30-Day Pilot <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/map"
              className="bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl px-6 py-3.5 text-center border border-slate-700 transition-colors"
            >
              See the live demo →
            </Link>
          </div>
          <p className="text-xs text-slate-500 mt-3">No credit card. We ship the trackers. Cancel anytime.</p>
        </div>

        {/* Map mock */}
        <div className="relative">
          <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700 overflow-hidden shadow-2xl relative">
            <div className="absolute top-4 left-4 bg-slate-900/70 backdrop-blur text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-700">
              🔴 After-hours movement — Skid Steer #3
            </div>
            {/* pins */}
            <span className="absolute w-3 h-3 rounded-full bg-amber-500 shadow-lg" style={{ top: '30%', left: '22%' }} />
            <span className="absolute w-3 h-3 rounded-full bg-amber-500 shadow-lg" style={{ top: '55%', left: '40%' }} />
            <span className="absolute w-3 h-3 rounded-full bg-teal-400 shadow-lg" style={{ top: '38%', left: '62%' }} />
            <span className="absolute w-3 h-3 rounded-full bg-teal-400 shadow-lg" style={{ top: '68%', left: '74%' }} />
            <span className="absolute w-4 h-4 rounded-full bg-red-500 shadow-lg ring-4 ring-red-500/30 animate-pulse" style={{ top: '20%', left: '80%' }} />
            <span className="absolute w-3 h-3 rounded-full bg-amber-500 shadow-lg" style={{ top: '75%', left: '28%' }} />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-4 py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-slate-800 rounded-2xl p-5 border border-slate-700">
              <div className="w-10 h-10 rounded-lg bg-amber-500/15 flex items-center justify-center mb-3">
                <Icon className="h-5 w-5 text-amber-400" />
              </div>
              <h3 className="font-bold">{title}</h3>
              <p className="text-sm text-slate-400 mt-1">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* vs Tenna */}
      <section className="max-w-3xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-center mb-6">Why contractors switch from Tenna</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {VS_TENNA.map(([us, them]) => (
            <div key={us} className="flex items-start gap-2 bg-slate-800/50 rounded-xl px-4 py-3 border border-slate-700">
              <Check className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-white">{us}</p>
                <p className="text-xs text-slate-500 line-through">{them}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-5xl mx-auto px-4 py-16 text-center">
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-3xl p-10">
          <Bell className="h-8 w-8 mx-auto mb-3" />
          <h2 className="text-3xl font-extrabold">Stop guessing where your gear is.</h2>
          <p className="text-white/90 mt-2 max-w-xl mx-auto">
            Start a free 30-day pilot. We ship you 5 trackers, you put your whole site on the map.
          </p>
          <Link
            href="/register"
            className="inline-flex items-center justify-center gap-2 bg-slate-900 text-white font-bold rounded-xl px-8 py-3.5 mt-6 hover:bg-slate-800 transition-colors"
          >
            Start Free Pilot <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-xs text-slate-500">
        HammerTrack · hammertrackai.com · Asset tracking for construction
      </footer>
    </div>
  )
}
