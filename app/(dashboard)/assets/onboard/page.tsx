import { DeviceOnboard } from '@/components/assets/DeviceOnboard'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getDevices, rollup } from '@/lib/db/devices'

export const metadata = { title: 'HammerTrack — Hardware setup' }

// Live signals come from the newest telemetry row per device, so this page
// must never be served from a cache — a stale "not reporting yet" is exactly
// the wrong answer for someone standing at the truck.
export const dynamic = 'force-dynamic'

export default async function DeviceOnboardPage() {
  const companyId = await getCurrentCompanyId()
  const devices = await getDevices(companyId)
  return <DeviceOnboard devices={devices} counts={rollup(devices)} />
}
