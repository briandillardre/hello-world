import Link from 'next/link'

/** The three pricing pages, one row of chips at the top of each. */
export function PricingNav({ at }: { at: 'book' | 'invoices' | 'rates' }) {
  const items = [
    { key: 'book', href: '/costbook', label: 'Cost book' },
    { key: 'invoices', href: '/costbook/invoices', label: 'Supplier invoices' },
    { key: 'rates', href: '/costbook/rates', label: 'Unit rates & bid history' },
  ] as const
  return (
    <nav className="flex gap-1.5 flex-wrap" aria-label="Pricing">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === at ? 'page' : undefined}
          className={'rounded-full px-3 py-1.5 text-[12px] font-semibold border ' + (i.key === at ? 'bg-amber/15 border-amber/40 text-amber' : 'border-navy-700 text-muted hover:text-ink')}>{i.label}</Link>
      ))}
    </nav>
  )
}
