'use client'

import { useState } from 'react'
import { Check, FileText, RefreshCw, Link2, Building2, X } from 'lucide-react'
import type { Asset, Geofence, QboConnection, QboInvoicePreview } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatRelativeTime } from '@/lib/utils'

interface AccountingViewProps {
  connection: QboConnection
  demo: boolean
  assets: Asset[]
  geofences: Geofence[]
  invoicesByFence: Record<string, QboInvoicePreview>
}

const TYPE_EMOJI: Record<string, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}

export function AccountingView({ connection, demo, assets, geofences, invoicesByFence }: AccountingViewProps) {
  const [preview, setPreview] = useState<QboInvoicePreview | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)

  const billableAssets = assets.filter(a => a.type === 'vehicle' || a.type === 'equipment')

  const handleSync = () => {
    setSyncing(true)
    setTimeout(() => { setSyncing(false); setSynced(true) }, 900)
  }

  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Accounting</h1>
        <Badge variant="success" className="flex items-center gap-1">
          <Check className="h-3 w-3" /> QuickBooks {demo ? 'Connected (Demo)' : 'Connected'}
        </Badge>
      </div>

      <div className="p-4 space-y-6 max-w-2xl">
        {/* Connection card */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-[#34d399]/15 flex items-center justify-center flex-shrink-0">
              <Building2 className="h-6 w-6 text-[#34d399]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-ink">{connection.company_name}</p>
              <p className="text-xs text-faint">
                Realm {connection.realm_id} · connected {formatRelativeTime(connection.connected_at)}
              </p>
            </div>
          </div>
          {demo && (
            <p className="mt-3 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-2">
              Demo connection. Add your Intuit app credentials (QBO_CLIENT_ID) to connect a real QuickBooks company.
            </p>
          )}
        </section>

        {/* Asset → QBO item mapping */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Assets → QuickBooks Items</h2>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {synced ? 'Synced' : 'Sync'}
            </Button>
          </div>
          <div className="bg-navy-900 rounded-xl border border-navy-800 divide-y divide-navy-800">
            {billableAssets.map(a => (
              <div key={a.id} className="p-3 flex items-center gap-3 text-sm">
                <span className="text-lg">{TYPE_EMOJI[a.type]}</span>
                <span className="flex-1 text-muted truncate">{a.name}</span>
                <Link2 className="h-3.5 w-3.5 text-faint" />
                <span className="text-muted text-xs truncate">Fixed Asset: {a.name}</span>
                {synced && <Check className="h-4 w-4 text-[#34d399] flex-shrink-0" />}
              </div>
            ))}
          </div>
        </section>

        {/* Job sites → invoices */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Job Sites → Equipment Billing</h2>
          <div className="bg-navy-900 rounded-xl border border-navy-800 divide-y divide-navy-800">
            {geofences.map(g => {
              const inv = invoicesByFence[g.id]
              const hasBillable = inv && inv.lines.length > 0
              return (
                <div key={g.id} className="p-4 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink text-sm truncate">{g.name}</p>
                    <p className="text-xs text-faint">
                      {hasBillable ? `${inv.lines.length} billable asset(s) · $${inv.total.toLocaleString()}` : 'No billable usage'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={hasBillable ? 'default' : 'outline'}
                    disabled={!hasBillable}
                    onClick={() => inv && setPreview(inv)}
                    className="gap-1 flex-shrink-0"
                  >
                    <FileText className="h-3.5 w-3.5" /> Invoice
                  </Button>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-faint text-center">
            Invoices are built from utilization × equipment hourly rates and pushed to QuickBooks.
          </p>
        </section>
      </div>

      {/* Invoice preview modal */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Equipment Usage Invoice</DialogTitle>
          </DialogHeader>
          {preview && (
            <div className="space-y-4 pt-2">
              <div className="text-sm">
                <span className="text-faint">Customer / Job:</span>{' '}
                <span className="font-medium text-ink">{preview.customer}</span>
              </div>
              <div className="border border-navy-800 rounded-lg overflow-hidden">
                {preview.lines.map((l, i) => (
                  <div key={i} className="p-3 border-b border-navy-800 last:border-0 flex justify-between gap-3 text-sm">
                    <span className="text-muted flex-1">{l.description}</span>
                    <span className="font-medium text-ink flex-shrink-0">${l.amount.toLocaleString()}</span>
                  </div>
                ))}
                <div className="p-3 bg-navy-800 flex justify-between font-semibold text-ink">
                  <span>Total</span>
                  <span>${preview.total.toLocaleString()}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setPreview(null)}>
                  <X className="h-4 w-4 mr-1" /> Close
                </Button>
                <Button className="flex-1" onClick={() => setPreview(null)}>
                  <Check className="h-4 w-4 mr-1" /> Push to QuickBooks
                </Button>
              </div>
              {demo && <p className="text-xs text-amber text-center">Demo: invoice preview only — not sent.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
