import { requireFeature, getRealPermissions } from '@/lib/permissions-server'
import { getFieldPhotos } from '@/lib/db/photos'
import { PhotosPage } from '@/components/photos/PhotosPage'

export const metadata = { title: 'HammerTrack — Photos' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Geotagged job photos — the crew's own record of every day (migration 101). */
export default async function Page() {
  const perms = await requireFeature('logs')
  const [photos, real] = await Promise.all([getFieldPhotos({ fromMs: Date.now() - 90 * 86_400_000, limit: 900 }), getRealPermissions()])
  return <PhotosPage photos={photos} canEdit={perms.canEdit} myId={real.userId} demo={isMock} />
}
