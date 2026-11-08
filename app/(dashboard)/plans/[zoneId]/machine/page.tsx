import { notFound } from 'next/navigation'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getGeofence } from '@/lib/db/zones'
import { getPlanRoom } from '@/lib/db/plans'
import { getMachineFiles } from '@/lib/db/machine'
import { fileStatus, markOlder, type SheetNow } from '@/lib/machine/status'
import { currentOf, revLabel } from '@/lib/plans/room'
import { MachineView } from '@/components/machine/MachineView'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Machine files · ${fence.name} — HammerTrack` : 'Machine files — HammerTrack' }
}

/** A site's machine files by revision (migration 149): what the machines run, and which plans it was built from. */
export default async function Page({ params }: { params: { zoneId: string } }) {
  const perms = await requireFeature('plans')
  if (isProspect(perms)) notFound()
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const real = await getRealPermissions()
  const [files, room] = await Promise.all([getMachineFiles(fence.id), getPlanRoom(fence.id, real.userId)])
  const sheets = new Map<string, SheetNow>(room.sheets.map((s) => [s.id, { id: s.id, number: s.number, pinnedVersionId: s.pinnedVersionId, voidedAt: s.voidedAt, versions: s.versions }]))
  const rows = markOlder(files).map((f) => ({ ...f, status: fileStatus(f.builtFrom, sheets) }))
  // What a new file can be built from: every live sheet at its current revision.
  const current = room.sheets.filter((s) => !s.voidedAt).flatMap((s) => {
    const cur = currentOf({ pinnedVersionId: s.pinnedVersionId }, s.versions)
    return cur ? [{ sheetId: s.id, versionId: cur.id, label: `${s.number} ${revLabel(cur.rev)}`, title: s.title }] : []
  }).sort((a, b) => a.label.localeCompare(b.label, 'en-US', { numeric: true }))
  const canEdit = perms.canEdit && !perms.viewingAs && !isMock && !fence.owner_id
  return (
    <MachineView zone={{ id: fence.id, name: fence.name }} files={rows} current={current}
      canEdit={canEdit} canDelete={canEdit && rankOf(perms) >= RANK.manager} demo={isMock} />
  )
}
