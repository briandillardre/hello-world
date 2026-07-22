import type { Metadata } from 'next'
import Link from 'next/link'
import { BRAND_EMAIL_SALES } from '@/lib/brand'
import { Logo } from '@/components/brand/Logo'

export const metadata: Metadata = {
  title: 'HammerTrack — Talk to us',
  description: 'Fleet pricing, multi-site rollouts, and hardware for large contractors.',
}

// No personal contact info on the public site (owner ask, Jul 23).
const SALES_EMAIL = BRAND_EMAIL_SALES

export default function ContactPage() {
  const subject = encodeURIComponent('HammerTrack — Fleet inquiry')
  const body = encodeURIComponent(
    'Company:\nNumber of trucks / machines / tools:\nCity / states you work in:\nWhat you’re tracking today (if anything):\n\nAnything else:',
  )
  return (
    <div className="min-h-screen bg-navy-950 text-ink flex flex-col">
      <header className="p-5 border-b border-navy-800">
        <Logo size={30} href="/" />
      </header>
      <main className="flex-1 grid place-items-center p-6">
        <div className="w-full max-w-lg text-center space-y-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-teal">Fleet &amp; multi-site</p>
          <h1 className="font-display font-black text-[2rem] leading-tight text-balance">Running 25+ assets or several yards? Let&rsquo;s scope it.</h1>
          <p className="text-muted text-[15px] max-w-[46ch] mx-auto">
            Tell us your fleet size and where you work. We&rsquo;ll come back with volume pricing, a rollout plan, and hardware at cost — usually same day. No sales gauntlet.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
            <a
              href={`mailto:${SALES_EMAIL}?subject=${subject}&body=${body}`}
              className="font-display font-bold rounded-xl px-6 py-3 bg-amber text-[#1a1100] hover:bg-amber-600 transition-colors"
            >
              Email {SALES_EMAIL}
            </a>
            <Link
              href="/register"
              className="font-display font-bold rounded-xl px-6 py-3 bg-white/[0.04] border border-navy-700 text-ink hover:bg-white/[0.07] transition-colors"
            >
              Or just start a free pilot
            </Link>
          </div>
          <p className="text-sm text-muted">
            Every email lands with the team that builds the product — not a call center.
          </p>
          <p className="text-xs text-faint pt-2">
            Prefer to see it first? <Link href="/map" className="text-amber hover:underline">Open the live map →</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
