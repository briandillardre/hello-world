import { getRecoveries } from '@/lib/db/recovery'
import { getToolAnonHistory } from '@/lib/db/tools'
import { RecoveryCard } from './RecoveryCard'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * The asset page's recovery block (132) — loads the asset's recoveries and,
 * for a tag, its newest anonymous sighting, then hands the card strings
 * already formatted in the viewer's zone. Renders nothing for a viewer who
 * cannot manage recovery while none is running.
 */
export async function RecoverySection({ assetId, isTool, canManage, viewerRank, tz, startOpen = false, alertEventId = null }: {
  assetId: string
  isTool: boolean
  canManage: boolean
  /** The viewer's ladder rank (view-as aware) — what they may read of the tag's anonymous sightings. */
  viewerRank: number
  tz: string
  startOpen?: boolean
  alertEventId?: string | null
}) {
  // The demo has no recoveries and cannot start one — no card at all.
  if (isMock) return null
  const [rows, heard] = await Promise.all([
    getRecoveries(assetId, 4),
    isTool ? getToolAnonHistory(assetId, viewerRank, 1) : Promise.resolve([]),
  ])
  const active = rows.find((r) => r.active) ?? null
  if (!active && !canManage) return null
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric' })
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const last = heard[0] ?? null
  return (
    <RecoveryCard
      assetId={assetId}
      isTool={isTool}
      canManage={canManage}
      active={active ? {
        startedByName: active.startedByName,
        startedText: when(active.startedAt),
        endsText: when(active.expiresAt),
        reason: active.reason,
      } : null}
      // Only what was heard while this recovery ran is "exact"; an older rough sighting says so.
      lastHeard={last ? { whenText: when(new Date(last.seenMs).toISOString()), exact: last.reason === 'recovery' } : null}
      past={canManage ? rows.filter((r) => !r.active).slice(0, 3).map((r) => ({
        text: `${day(r.startedAt)}–${day(r.endedAt ?? r.expiresAt)} · ${r.startedByName ?? 'an Admin'}${r.endedByName ? `, stopped by ${r.endedByName}` : r.endedAt && !r.endedByName ? ', ran out' : ''}`,
        reason: r.reason,
      })) : []}
      startOpen={startOpen}
      alertEventId={alertEventId}
    />
  )
}
