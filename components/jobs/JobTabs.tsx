'use client'

/**
 * The tab strip on every job page (office review, Nov 19: going from Pay apps
 * to Job cost took two clicks and a reload through the job hub). The job hub,
 * then the money pages (costs logins), then the field pages — one tap apart.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function JobTabs({ zoneId, costs }: { zoneId: string; costs: boolean }) {
  const path = usePathname()
  const base = `/jobs/${zoneId}`
  const tabs = [
    { href: base, label: 'The job' },
    ...(costs ? [{ href: `${base}/billing`, label: 'Pay apps' }, { href: `${base}/cost`, label: 'Job cost' }] : []),
    { href: `${base}/production`, label: 'Production' },
    { href: `${base}/issues`, label: 'Issues' },
    { href: `${base}/documents`, label: 'Documents' },
    { href: `/plans/${zoneId}`, label: 'Plans' },
  ]
  return (
    <nav aria-label="Job pages" className="-mx-1 mb-3 flex gap-1 overflow-x-auto pb-1">
      {tabs.map((t) => {
        const on = path === t.href
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined}
            className={'whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium ' + (on ? 'bg-amber/15 text-amber' : 'text-muted hover:text-ink hover:bg-navy-800/60')}>
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
