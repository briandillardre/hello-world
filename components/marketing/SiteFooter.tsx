import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-navy-800">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
        <Logo size={26} />
        <div className="flex items-center gap-6 text-[13px] text-faint">
          <Link href="/pricing" className="hover:text-ink transition-colors">Pricing</Link>
          <Link href="/demo" className="hover:text-ink transition-colors">Demo</Link>
          <Link href="/login" className="hover:text-ink transition-colors">Sign in</Link>
        </div>
        <p className="text-[13px] text-faint">© {new Date().getFullYear()} HammerTrack · hammertrackai.com</p>
      </div>
    </footer>
  )
}
