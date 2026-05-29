import { AccountingView } from '@/components/accounting/AccountingView'
import { getConnectionStatus, buildEquipmentUsageInvoice } from '@/lib/qbo'
import { getAssets } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { MOCK_COMPANY } from '@/lib/mock-data'
import type { QboInvoicePreview } from '@/lib/types'

export default async function AccountingPage() {
  const status = getConnectionStatus()
  const [assets, geofences] = await Promise.all([
    getAssets(MOCK_COMPANY.id),
    getGeofences(MOCK_COMPANY.id),
  ])

  const invoicesByFence: Record<string, QboInvoicePreview> = {}
  for (const g of geofences) {
    invoicesByFence[g.id] = buildEquipmentUsageInvoice(g.id, g.name)
  }

  // status.connection is non-null in demo mode; guard for the unconfigured path.
  if (!status.connection) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-slate-400">
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
