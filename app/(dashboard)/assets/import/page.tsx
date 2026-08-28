import { BulkImport } from '@/components/assets/BulkImport'
import { getAssets } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'

export const metadata = { title: 'HammerTrack — Bulk add assets' }

const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Spreadsheet-style bulk load: paste the fleet, fix what's flagged, import.
 *  The existing fleet rides along so duplicates are caught in the grid rather
 *  than by a Postgres error halfway through the batch. */
export default async function BulkImportPage() {
  const companyId = await getCurrentCompanyId()
  const [assets, perms] = await Promise.all([getAssets(companyId), getMyPermissions()])

  return (
    <div className="h-full overflow-y-auto pb-[54px] md:pb-20">
      <BulkImport
        existingNames={assets.map((a) => a.name)}
        // Active only — that's what the uniqueness index enforces, and
        // deactivating an asset is how its tracker is freed for the next truck.
        existingTrackers={assets.filter((a) => a.active && a.tracker_id).map((a) => a.tracker_id as string)}
        canViewCosts={perms.canViewCosts}
        isDemo={isDemo}
      />
    </div>
  )
}
