import Link from 'next/link'
import { BRAND_NAME, BRAND_DOMAIN, BRAND_EMAIL_HELLO } from '@/lib/brand'
import { Logo } from '@/components/brand/Logo'

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-navy-800">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex flex-col md:flex-row items-start justify-between gap-8">
          <div>
            <Logo size={26} />
            <p className="text-[13px] text-faint mt-3 max-w-[34ch]">
              Every truck, machine, crew, and tool on one live map — with AI watching for the
              moment something moves when it shouldn&apos;t.
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-faint mt-4">
              Built in South Carolina
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-14 gap-y-2 text-[13px]">
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint mb-1">Product</span>
              <Link href="/demo" className="text-muted hover:text-ink transition-colors">Live demo</Link>
              <Link href="/pricing" className="text-muted hover:text-ink transition-colors">Pricing</Link>
              <Link href="/login" className="text-muted hover:text-ink transition-colors">Sign in</Link>
              <Link href="/register" className="text-muted hover:text-ink transition-colors">Start free pilot</Link>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint mb-1">Company</span>
              <a href={`mailto:${BRAND_EMAIL_HELLO}`} className="text-muted hover:text-ink transition-colors">{BRAND_EMAIL_HELLO}</a>
              <Link href="/privacy" className="text-muted hover:text-ink transition-colors">Privacy policy</Link>
              <Link href="/terms" className="text-muted hover:text-ink transition-colors">Terms of service</Link>
            </div>
          </div>
        </div>
        <p className="text-[12px] text-faint mt-10 pt-6 border-t border-navy-800/60">
          © {new Date().getFullYear()} {BRAND_NAME} · {BRAND_DOMAIN}
        </p>
      </div>
    </footer>
  )
}
