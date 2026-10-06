import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { requireFeature } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { emptyPilot, loadFuelPilot, type FuelPilotView } from '@/lib/db/fuel-check'
import { demoFuelPilot } from '@/lib/fuel-check-demo'
import { dayKey, safeTz } from '@/lib/dates'
import { FuelPilot } from '@/components/receipts/fuel/FuelPilot'

export const metadata = { title: 'HammerTrack — Fuel check' }
export const dynamic = 'force-dynamic'
// The import and re-check actions run from this page: placing stations and
// reading each purchase's evidence takes seconds per purchase.
export const maxDuration = 60

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * /receipts/fuel — the fuel reconciliation pilot (migration 130,
 * docs/FUEL-RECONCILIATION.md). Every fuel purchase read against the truck's
 * own evidence, four exceptions only, a verdict on each. It is money from top
 * to bottom, so it takes the Receipts view level AND the $ figures; writes
 * take the edit ability (checked again in every action).
 */
export default async function Page() {
  const perms = await requireFeature('receipts')
  if (!perms.canViewCosts) notFound()
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const todayKey = dayKey(Date.now(), tz)
  let view: FuelPilotView = emptyPilot(todayKey)
  if (isMock) view = demoFuelPilot(todayKey, tz)
  else {
    const [{ createClient }, companyId] = await Promise.all([import('@/lib/supabase-server'), getCurrentCompanyId()])
    view = await loadFuelPilot(createClient(), companyId, { todayKey, viewer: perms })
  }
  return (
    <FuelPilot
      view={view}
      tz={tz}
      todayKey={todayKey}
      canEdit={perms.canEdit && !perms.viewingAs}
      previewing={!!perms.viewingAs}
      demo={isMock}
    />
  )
}
