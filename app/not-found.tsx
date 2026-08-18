import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/brand/Logo'

export const metadata: Metadata = {
  title: 'HammerTrack — Not found',
}

/** Branded 404 — a dead link should still feel like the product. */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="mb-6">
        <Logo size={34} href="/" />
      </div>
      <h1 className="font-display font-black text-2xl sm:text-3xl text-ink text-balance">
        This page wandered off the jobsite.
      </h1>
      <p className="text-sm text-muted mt-2">
        The link is broken or the page moved — your fleet is still right where you left it.
      </p>
      <div className="mt-7 flex flex-col sm:flex-row gap-3 w-full max-w-xs">
        <Link
          href="/map"
          className="flex-1 text-center font-display font-bold rounded-xl py-3 bg-amber text-[#1a1100] hover:bg-amber-600 transition-colors"
        >
          Live map
        </Link>
        <Link
          href="/"
          className="flex-1 text-center font-display font-bold rounded-xl py-3 border border-navy-700 text-muted hover:bg-navy-800 hover:text-ink transition-colors"
        >
          Home
        </Link>
      </div>
    </div>
  )
}
