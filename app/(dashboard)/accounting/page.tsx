import { AccountingView } from '@/components/accounting/AccountingView'
import { getConnectionStatus, buildEquipmentUsageInvoice, isQboConfigured } from '@/lib/qbo'
import { getAssets } from '@/lib/db/assets'
import { getGeofences } from '@/lib/db/geofences'
import { getCurrentCompanyId, getMyRole } from '@/lib/db/company'
import type { QboInvoicePreview } from '@/lib/types'
import { Building2 } from 'lucide-react'

export default async function AccountingPage() {
  const companyId = await getCurrentCompanyId()
  const [status, assets, geofences, role] = await Promise.all([
    getConnectionStatus(companyId),
    getAssets(companyId),
    getGeofences(companyId),
    getMyRole(),
  ])

  // Real account, not connected yet → the connect flow, not a dead end.
  if (!status.connection) {
    return (
      <div className="h-full overflow-auto pb-[70px] md:pb-20">
        <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
          <h1 className="text-xl font-bold text-ink">Accounting</h1>
        </div>
        <div className="p-4 max-w-md mx-auto mt-8">
          <div className="bg-navy-900 rounded-2xl border border-navy-800 p-6 text-center">
            <div className="w-14 h-14 rounded-xl bg-[#34d399]/15 grid place-items-center mx-auto mb-4">
              <Building2 className="h-7 w-7 text-[#34d399]" />
            </div>
            <h2 className="font-display font-bold text-ink text-lg">Connect QuickBooks</h2>
            <p className="text-sm text-muted mt-2 leading-relaxed">
              Bill tracked equipment &amp; labor hours per job site as draft invoices, and send
              maintenance costs straight to your books as expenses.
            </p>
            {isQboConfigured ? (
              <a
                href="/api/qbo/connect"
                className="inline-flex items-center justify-center mt-5 rounded-lg bg-[#2ca01c] hover:bg-[#248217] text-white font-display font-bold text-sm px-5 py-2.5 transition-colors"
              >
                Connect to QuickBooks
              </a>
            ) : (
              <p className="mt-5 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-3 text-left">
                Setup needed: create an app at developer.intuit.com, then add QBO_CLIENT_ID,
                QBO_CLIENT_SECRET, QBO_REDIRECT_URI and QBO_ENVIRONMENT to the Vercel env vars.
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Demo previews power the demo site's invoice modal only.
  const invoicesByFence: Record<string, QboInvoicePreview> = {}
  if (status.demo) {
    for (const g of geofences) {
      invoicesByFence[g.id] = buildEquipmentUsageInvoice(g.id, g.name)
    }
  }

  return (
    <AccountingView
      connection={status.connection}
      demo={status.demo}
      canPush={role !== 'viewer'}
      assets={assets}
      geofences={geofences}
      invoicesByFence={invoicesByFence}
    />
  )
}
