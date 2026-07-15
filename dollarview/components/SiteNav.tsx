import Link from 'next/link'
import { CircleDollarSign } from 'lucide-react'

export function SiteNav() {
  return (
    <header className="border-b border-grid bg-surface">
      <div className="mx-auto flex h-14 max-w-page items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <CircleDollarSign className="h-6 w-6 text-brand" aria-hidden />
          DollarView
        </Link>
        <nav className="flex items-center gap-5 text-sm text-ink2">
          <Link href="/methodology" className="hover:text-ink">
            Methodology
          </Link>
        </nav>
      </div>
    </header>
  )
}
