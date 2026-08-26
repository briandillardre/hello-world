import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'

// Intrinsic aspect of /brand/hammertrack-mark.png (56×96 — downscaled from
// the 201×344 original, kept as hammertrack-mark-full.png for print/large use).
const MARK_RATIO = 56 / 96

/**
 * HammerTrack logo lockup: the navy mark (pin + hammer + signal waves) plus a
 * styled wordmark. On dark surfaces the mark is rendered white via `mark-white`.
 * Scales cleanly at any size and recolors per surface — unlike the raster lockup.
 */
export function Logo({
  href = '/',
  className,
  markClassName,
  wordmark = true,
  onDark = true,
  size = 32,
}: {
  href?: string | null
  className?: string
  markClassName?: string
  wordmark?: boolean
  onDark?: boolean
  size?: number
}) {
  const inner = (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <Image
        src="/brand/hammertrack-mark.png"
        alt="HammerTrack"
        width={Math.round(size * MARK_RATIO)}
        height={size}
        sizes={`${Math.round(size * MARK_RATIO)}px`}
        style={{ height: size, width: 'auto' }}
        className={cn(onDark && 'mark-white', markClassName)}
      />
      {wordmark && (
        <span
          className={cn(
            'font-display font-black uppercase tracking-[0.05em] leading-none',
            onDark ? 'text-ink' : 'text-navy'
          )}
          style={{ fontSize: size * 0.58 }}
        >
          Hammer<span className="text-teal">Track</span>
        </span>
      )}
    </span>
  )

  if (href === null) return inner
  return (
    <Link href={href} className="inline-flex items-center">
      {inner}
    </Link>
  )
}
