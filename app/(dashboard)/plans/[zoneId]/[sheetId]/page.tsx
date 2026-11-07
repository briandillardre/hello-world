import { notFound } from 'next/navigation'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { getGeofence } from '@/lib/db/zones'
import { getPlanRoom } from '@/lib/db/plans'
import { SheetViewer } from '@/components/plans/SheetViewer'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export const metadata = { title: 'Sheet — HammerTrack' }

/** One sheet of a site's plan room, every version (migration 143). */
export default async function Page({ params, searchParams }: { params: { zoneId: string; sheetId: string }; searchParams: { v?: string } }) {
  const perms = await requireFeature('plans')
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const real = await getRealPermissions()
  const room = await getPlanRoom(fence.id, real.userId)
  const sheet = room.sheets.find((s) => s.id === params.sheetId)
  if (!sheet || !sheet.versions.length) notFound()
  const want = typeof searchParams.v === 'string' && sheet.versions.some((v) => v.id === searchParams.v) ? searchParams.v : null
  return (
    <SheetViewer
      key={sheet.id}
      zone={{ id: fence.id, name: fence.name }}
      sheet={sheet}
      initialVersionId={want ?? sheet.currentId ?? sheet.versions[0].id}
      images={room.images}
      sets={room.sets.map((s) => ({ id: s.id, name: s.name, kind: s.kind, issuedOn: s.issuedOn }))}
      canEdit={perms.canEdit && !perms.viewingAs && !isMock}
    />
  )
}
