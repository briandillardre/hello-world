import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'

// Intrinsic aspect of /brand/hammertrack-mark.png (168×288 — a 3× render of
// the 56×96 box so retina phones stay crisp, downscaled from the 201×344
// original kept as hammertrack-mark-full.png for print/large use). Sep 4:
// the old 56×96 file was a THREE-arc variant; the app icon, splash, PWA icon
// and email avatar all carry two arcs, so the header now matches them.
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
  wordmarkClassName,
  wordmark = true,
  onDark = true,
  size = 32,
}: {
  href?: string | null
  className?: string
  markClassName?: string
  /** Extra classes on the wordmark alone — e.g. `max-[400px]:hidden` to fall
   *  back to the bare mark where a header runs out of room. */
  wordmarkClassName?: string
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
            onDark ? 'text-ink' : 'text-navy',
            wordmarkClassName
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
