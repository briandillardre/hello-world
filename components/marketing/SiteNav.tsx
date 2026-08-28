'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'

const LINKS = [
  { href: '/#features', label: 'Product' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/login', label: 'Sign in' },
]

export function SiteNav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="relative z-30">
      {/* min-w-0 + shrink-0: without them the logo and the CTA both refused to
          give, so on a narrow phone the amber button sat ON TOP of the
          wordmark (Brian's Galaxy S26 screenshot — "HAMMERTRAC"). The logo
          now scales down first, and the CTA drops to a short label. */}
      <nav className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3 py-5">
        <div className="min-w-0 shrink">
          <Logo size={32} wordmarkClassName="max-[380px]:hidden" />
        </div>
        <div className="flex items-center gap-3 sm:gap-6 shrink-0 text-[14.5px] font-medium text-muted">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hidden sm:inline hover:text-ink transition-colors">
              {l.label}
            </Link>
          ))}
          <Link
            href="/register"
            className="font-display font-bold text-[13px] sm:text-[14px] whitespace-nowrap rounded-xl px-3 sm:px-4 py-2.5 bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors"
          >
            {/* "Start free pilot" is three words too many at 360px. */}
            <span className="hidden min-[480px]:inline">Start free pilot</span>
            <span className="min-[480px]:hidden">Start free</span>
          </Link>
          {/* phone-only menu toggle — the text links above are hidden below sm */}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="site-nav-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="sm:hidden -mr-2 grid place-items-center min-w-[44px] min-h-[44px] rounded-xl text-muted hover:text-ink hover:bg-white/[0.05] transition-colors"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <div
          id="site-nav-menu"
          className="sm:hidden absolute inset-x-0 top-full z-30 border-y border-navy-800 bg-navy-950/95 backdrop-blur px-6 py-3 shadow-panel"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block py-3 text-[15px] font-medium text-muted hover:text-ink transition-colors"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/register"
            onClick={() => setOpen(false)}
            className="block py-3 text-[15px] font-display font-bold text-amber"
          >
            Start free pilot
          </Link>
        </div>
      )}
    </header>
  )
}
