import { notFound } from 'next/navigation'
import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { getGeofence } from '@/lib/db/zones'
import { getPlanRoom } from '@/lib/db/plans'
import { StitchView, type StitchSheet } from '@/components/plans/StitchView'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { zoneId: string } }) {
  const fence = await getGeofence(params.zoneId).catch(() => null)
  return { title: fence ? `Whole site · ${fence.name} — HammerTrack` : 'Whole site — HammerTrack' }
}

/** Every placed sheet of a site in one continuous plan (components/plans/StitchView.tsx). */
export default async function Page({ params }: { params: { zoneId: string } }) {
  await requireFeature('plans')
  const fence = await getGeofence(params.zoneId)
  if (!fence || fence.kind === 'boundary' || fence.kind === 'vendor') notFound()
  const real = await getRealPermissions()
  const data = await getPlanRoom(fence.id, real.userId)
  const sheets: StitchSheet[] = []
  for (const s of data.sheets) {
    if (s.voidedAt) continue
    const cur = s.versions.find((v) => v.id === s.currentId)
    const img = cur?.imageId ? data.images[cur.imageId] : undefined
    if (!cur || !img?.bounds) continue
    const p = cur.placement
    const check = !!p && (p.check === true || (p.source === 'carried' && p.check !== false))
    sheets.push({
      id: s.id, number: s.number, title: s.title ?? null, discipline: s.discipline ?? null, url: img.url,
      bounds: img.bounds as StitchSheet['bounds'], crop: cur.crop ?? null, check,
    })
  }
  sheets.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
  return <StitchView zone={{ id: fence.id, name: fence.name }} sheets={sheets} />
}
