import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-grid bg-surface">
      <div className="mx-auto flex max-w-page flex-col gap-2 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-semibold text-ink2">DollarView</span> — public spending, made legible.
        </p>
        <p>
          Every number is sourced and every formula is published.{' '}
          <Link href="/methodology" className="underline hover:text-ink">
            How this works
          </Link>
        </p>
      </div>
    </footer>
  )
}
