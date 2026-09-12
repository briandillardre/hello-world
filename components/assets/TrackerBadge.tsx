import { trackerKind, type DeviceModel } from '@/lib/devices'

/**
 * What kind of box is on this machine, at a glance (Brian, Sep 12: "a quick
 * and easy way to see what type of tracker is on each asset both at top of
 * asset page and on small view when clicked on map").
 *
 * The tracker ID was already on both screens, but an IMEI answers "which box"
 * and never "what box" — and the difference decides what normal looks like.
 * An OBD unit going silent at 5 PM is a truck that shut off; a battery box
 * silent for the same six hours is also fine; a wired unit silent for six
 * hours is a problem. One chip, same words on every surface.
 *
 * Server-safe: pure derivation from the id, no client state and no query.
 */
export function TrackerBadge({ trackerId, model, size = 'sm', className = '' }: {
  trackerId: string | null | undefined
  /** Registry model when the caller already holds it — a registered box knows
   *  itself better than a TAC guess. */
  model?: DeviceModel | null
  /** 'xs' matches the assets list's pill row; 'sm' the header badge rows.
   *  An explicit size beats overriding classes — there is no class-merge
   *  helper here, so a later Tailwind class does not reliably win. */
  size?: 'sm' | 'xs'
  className?: string
}) {
  const k = trackerKind(trackerId, model)
  const tone = k.key === 'none'
    ? 'border-navy-700 text-faint'
    : k.key === 'tag'
      ? 'border-teal/40 text-teal'
      : 'border-[#60a5fa]/40 text-[#93c5fd]'
  const shape = size === 'xs'
    ? 'rounded-full px-1.5 py-px text-[10px] gap-0.5'
    : 'rounded-md px-1.5 py-0.5 text-[11px] gap-1'
  return (
    <span
      title={k.hint}
      className={`inline-flex items-center border font-semibold leading-none whitespace-nowrap flex-shrink-0 ${shape} ${tone} ${className}`}
    >
      <span aria-hidden>{k.icon}</span>
      {k.label}
    </span>
  )
}
