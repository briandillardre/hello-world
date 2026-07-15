'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '', label: 'Overview' },
  { href: '/receipt', label: 'My receipt' },
  { href: '/budget', label: 'Budget' },
  { href: '/projects', label: 'Projects' },
  { href: '/vendors', label: 'Vendors' },
]

export function EntityTabs({ slug }: { slug: string }) {
  const pathname = usePathname()
  return (
    <nav className="scrollbar-none -mb-px flex gap-1 overflow-x-auto" aria-label="Entity sections">
      {TABS.map((tab) => {
        const href = `/${slug}${tab.href}`
        const active = tab.href === '' ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={tab.href}
            href={href}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium',
              active ? 'border-brand text-ink' : 'border-transparent text-ink2 hover:border-baseline hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
