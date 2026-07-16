import type { LiveStatus } from '@/lib/live-status'
import { shortDuration } from '@/lib/live-status'

/**
 * Current-status badge — the "what's it doing now" line. Shows the derived
 * state (Moving / Idling / Parked / No signal) with a colored dot, plus
 * today's idle total when known ("Idled 1h 09m today"). No hooks, so it drops
 * into both the client map popup and the server-rendered asset page.
 */
export function LiveStatusBadge({
  status, idleTodayMin, lastSeenMs, compact = false,
}: {
  status: LiveStatus
  /** Minutes stationary-with-engine-idle today (from range stats). */
  idleTodayMin?: number | null
  /** Newest fix time, for the "updated Xm ago" caption. */
  lastSeenMs?: number | null
  compact?: boolean
}) {
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
      <div className="flex items-center gap-2">
        <span
          className={'relative flex-none rounded-full ' + (compact ? 'h-2.5 w-2.5' : 'h-3 w-3')}
          style={{ backgroundColor: status.color, boxShadow: `0 0 8px ${status.color}88` }}
        >
          {status.live && (
            <span className="absolute inset-0 rounded-full animate-ping" style={{ backgroundColor: status.color, opacity: 0.6 }} />
          )}
        </span>
        <span className="font-display font-bold text-ink leading-none" style={{ fontSize: compact ? 14 : 15 }}>{status.label}</span>
        <span className="text-faint text-[12px] truncate">· {status.detail}</span>
      </div>
      <div className="flex items-center gap-2 pl-5 text-[11px] text-faint">
        {idleTodayMin != null && idleTodayMin >= 1 && (
          <span className="text-amber/90">Idled {shortDuration(idleTodayMin * 60_000)} today</span>
        )}
        {lastSeenMs != null && (
          <span>{idleTodayMin != null && idleTodayMin >= 1 ? '· ' : ''}updated {shortDuration(Date.now() - lastSeenMs)} ago</span>
        )}
      </div>
    </div>
  )
}
