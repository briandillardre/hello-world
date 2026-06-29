import { AccountingView } from '@/components/accounting/AccountingView'
import { getConnectionStatus, buildEquipmentUsageInvoice } from '@/lib/qbo'
import { getAssets } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getCurrentCompanyId } from '@/lib/db/company'
import type { QboInvoicePreview } from '@/lib/types'

export default async function AccountingPage() {
  const status = getConnectionStatus()
  const companyId = await getCurrentCompanyId()
  const [assets, geofences] = await Promise.all([
    getAssets(companyId),
    getGeofences(companyId),
  ])

  const invoicesByFence: Record<string, QboInvoicePreview> = {}
  for (const g of geofences) {
    invoicesByFence[g.id] = buildEquipmentUsageInvoice(g.id, g.name)
  }

  // status.connection is non-null in demo mode; guard for the unconfigured path.
  if (!status.connection) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-faint">
        QuickBooks not connected.
      </div>
    )
  }

  return (
    <AccountingView
      connection={status.connection}
      demo={status.demo}
      assets={assets}
      geofences={geofences}
      invoicesByFence={invoicesByFence}
    />
  )
}
