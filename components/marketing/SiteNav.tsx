import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'

const LINKS = [
  { href: '/#features', label: 'Product' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/login', label: 'Sign in' },
]

export function SiteNav() {
  return (
    <header className="relative z-10">
      <nav className="max-w-6xl mx-auto px-6 flex items-center justify-between py-5">
        <Logo size={32} />
        <div className="flex items-center gap-6 text-[14.5px] font-medium text-muted">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hidden sm:inline hover:text-ink transition-colors">
              {l.label}
            </Link>
          ))}
          <Link
            href="/register"
            className="font-display font-bold text-[14px] rounded-xl px-4 py-2.5 bg-amber text-[#1a1100] shadow-glow-amber hover:bg-amber-600 transition-colors"
          >
            Start free pilot
          </Link>
        </div>
      </nav>
    </header>
  )
}
