'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileText, RefreshCw, Link2, Building2, X, ExternalLink, Loader2, Unplug, ArrowLeftRight, FlaskConical } from 'lucide-react'
import type { Asset, Geofence, QboConnection, QboInvoicePreview } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchInput, SortPills } from '@/components/ui/list-controls'
import { confirmSheet } from '@/components/ui/feedback'
import { formatRelativeTime } from '@/lib/utils'
import { previewZoneInvoiceAction, pushZoneInvoiceAction, disconnectQboAction, type ZoneInvoiceDraft } from '@/lib/actions/qbo'
import { QboTimeCard } from '@/components/accounting/QboTimeCard'

interface AccountingViewProps {
  connection: QboConnection
  demo: boolean
  /** Pointed at Intuit's SANDBOX — badge it loudly so test books are never
   *  mistaken for the real company. */
  sandbox?: boolean
  canPush?: boolean
  assets: Asset[]
  geofences: Geofence[]
  invoicesByFence: Record<string, QboInvoicePreview>
}

const TYPE_EMOJI: Record<string, string> = {
  vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧',
}

const PERIODS = [
  { days: 7, label: 'Last 7 days' },
  { days: 14, label: 'Last 14 days' },
  { days: 30, label: 'Last 30 days' },
]

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

type SiteSort = 'name' | 'newest'

export function AccountingView({ connection, demo, sandbox = false, canPush = true, assets, geofences, invoicesByFence }: AccountingViewProps) {
  const router = useRouter()
  const [preview, setPreview] = useState<QboInvoicePreview | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const [siteQuery, setSiteQuery] = useState('')
  const [siteSort, setSiteSort] = useState<SiteSort>('name')
  const [disconnecting, setDisconnecting] = useState(false)
  const [connError, setConnError] = useState<string | null>(null)

  const disconnect = async () => {
    const ok = await confirmSheet({
      title: `Disconnect ${connection.company_name}?`,
      message: 'Nothing changes in QuickBooks — HammerTrack just forgets the link until you reconnect.',
      confirmLabel: 'Disconnect', destructive: true,
    })
    if (!ok) return
    setDisconnecting(true)
    setConnError(null)
    const r = await disconnectQboAction()
    setDisconnecting(false)
    if ('error' in r) setConnError(r.error)
    else router.refresh()
  }

  // Real-mode invoice dialog: period → live draft from tracked usage → push.
  const [fence, setFence] = useState<Geofence | null>(null)
  const [days, setDays] = useState(7)
  const [draft, setDraft] = useState<ZoneInvoiceDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushed, setPushed] = useState<{ docNumber: string; total: number; url: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!fence || demo) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setDraft(null)
    previewZoneInvoiceAction(fence.id, days).then((r) => {
      if (cancelled) return
      if ('error' in r) setError(r.error)
      else setDraft(r)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fence, days, demo])

  const closeReal = () => { setFence(null); setDraft(null); setPushed(null); setError(null); setDays(7) }

  const push = async () => {
    if (!fence) return
    setPushing(true)
    setError(null)
    const r = await pushZoneInvoiceAction(fence.id, days)
    setPushing(false)
    if ('error' in r) setError(r.error)
    else setPushed(r)
  }

  const billableAssets = assets.filter(a => a.type === 'vehicle' || a.type === 'equipment')

  const sites = geofences
    .filter((g) => !siteQuery || g.name.toLowerCase().includes(siteQuery.toLowerCase()))
    .sort((a, b) => (siteSort === 'newest'
      ? (b.created_at ?? '').localeCompare(a.created_at ?? '')
      : a.name.localeCompare(b.name, undefined, { numeric: true })))

  const handleSync = () => {
    setSyncing(true)
    setTimeout(() => { setSyncing(false); setSynced(true) }, 900)
  }

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Accounting</h1>
        {sandbox && !demo ? (
          <Badge variant="default" className="flex items-center gap-1 bg-amber/20 text-amber border-amber/40">
            <FlaskConical className="h-3 w-3" /> QuickBooks Sandbox
          </Badge>
        ) : (
          <Badge variant="success" className="flex items-center gap-1">
            <Check className="h-3 w-3" /> QuickBooks {demo ? 'Connected (Demo)' : 'Connected'}
          </Badge>
        )}
      </div>

      <div className="p-4 space-y-6 max-w-2xl">
        {/* Connection card — which company, which environment, and the levers
            to switch or cut it. This is Accounting's control panel for QBO. */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-[#34d399]/15 flex items-center justify-center flex-shrink-0">
              <Building2 className="h-6 w-6 text-[#34d399]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-ink">{connection.company_name}</p>
              <p className="text-xs text-faint" suppressHydrationWarning>
                Realm {connection.realm_id} · connected {formatRelativeTime(connection.connected_at)}
              </p>
            </div>
          </div>
          {demo && (
            <p className="mt-3 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-2">
              Demo connection. Add your Intuit app credentials (QBO_CLIENT_ID) to connect a real QuickBooks company.
            </p>
          )}
          {sandbox && !demo && (
            <p className="mt-3 text-xs text-amber bg-amber/15 border border-amber/30 rounded-lg p-2 leading-relaxed">
              This is Intuit&rsquo;s <span className="font-semibold">sandbox</span> — practice books, not your real company.
              Invoices and expenses land in the fake &ldquo;{connection.company_name}&rdquo;. To connect your real
              QuickBooks: set the production keys + <span className="font-mono">QBO_ENVIRONMENT=production</span> in
              Vercel, redeploy, then tap Switch company below and sign in as the account that owns your books.
            </p>
          )}
          {!demo && canPush && (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <a
                href="/api/qbo/connect"
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2ca01c] hover:bg-[#248217] text-white font-semibold text-xs px-3 py-2 transition-colors"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" /> Switch company / reconnect
              </a>
              <button
                onClick={disconnect}
                disabled={disconnecting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-navy-700 text-faint hover:text-alert hover:border-alert/40 font-semibold text-xs px-3 py-2 transition-colors disabled:opacity-60"
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />} Disconnect
              </button>
            </div>
          )}
          {connError && (
            <p className="mt-2 text-xs text-alert bg-alert/10 border border-alert/30 rounded-lg p-2">{connError}</p>
          )}
        </section>

        {/* Crew → QBO employee mapping + the timesheet push explainer.
            Pushing itself lives on /logs where the day's hours are reviewed. */}
        <QboTimeCard demo={demo} />

        {/* Asset → QBO item mapping — demo showcase only (real flow bills usage
            per job; a fixed-asset catalog sync earns its keep later). */}
        {demo && (
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
                  <span className="text-muted text-xs truncate">Fixed Asset ✓</span>
                  {synced && <Check className="h-4 w-4 text-[#34d399] flex-shrink-0" />}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Job sites → invoices */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">Job Sites → Equipment Billing</h2>
          {geofences.length > 3 && (
            <div className="flex items-center gap-2 flex-wrap">
              <SearchInput value={siteQuery} onChange={setSiteQuery} placeholder="Search job sites…" />
              <SortPills<SiteSort> options={[['name', 'A → Z'], ['newest', 'Newest']]} value={siteSort} onChange={setSiteSort} />
            </div>
          )}
          <div className="bg-navy-900 rounded-xl border border-navy-800 divide-y divide-navy-800">
            {geofences.length === 0 && (
              <p className="p-4 text-sm text-faint">Draw a zone around a job site on the map first — invoices bill the usage tracked inside it.</p>
            )}
            {geofences.length > 0 && sites.length === 0 && (
              <p className="p-4 text-sm text-faint">Nothing matches that search.</p>
            )}
            {sites.map(g => {
              const inv = invoicesByFence[g.id]
              const hasBillable = demo ? (inv && inv.lines.length > 0) : true
              return (
                <div key={g.id} className="p-4 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink text-sm truncate">{g.name}</p>
                    <p className="text-xs text-faint">
                      {demo
                        ? (hasBillable ? `${inv.lines.length} billable asset(s) · ${money(inv.total)}` : 'No billable usage')
                        : 'Bill tracked usage → draft invoice'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={hasBillable ? 'default' : 'outline'}
                    disabled={!hasBillable || (!demo && !canPush)}
                    onClick={() => demo ? (inv && setPreview(inv)) : setFence(g)}
                    className="gap-1 flex-shrink-0"
                  >
                    <FileText className="h-3.5 w-3.5" /> Invoice
                  </Button>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-faint text-center">
            Invoices are built from tracked usage × your per-asset rates and created as drafts in QuickBooks.
          </p>
        </section>
      </div>

      {/* Demo invoice preview modal */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
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
                    <span className="font-medium text-ink flex-shrink-0">{money(l.amount)}</span>
                  </div>
                ))}
                <div className="p-3 bg-navy-800 flex justify-between font-semibold text-ink">
                  <span>Total</span>
                  <span>{money(preview.total)}</span>
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

      {/* REAL invoice flow: period → tracked-usage draft → create in QBO */}
      <Dialog open={!!fence} onOpenChange={(o) => !o && closeReal()}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice · {fence?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!pushed && (
              <div className="flex items-center gap-0.5 bg-navy-950 rounded-lg p-0.5 border border-navy-800">
                {PERIODS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => setDays(p.days)}
                    disabled={loading || pushing}
                    className={
                      'flex-1 py-1.5 rounded-md text-[12px] font-semibold transition-colors ' +
                      (days === p.days ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
                    }
                  >{p.label}</button>
                ))}
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-faint text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Reading tracked usage…
              </div>
            )}

            {!loading && !pushed && draft && (
              draft.lines.length > 0 ? (
                <div className="border border-navy-800 rounded-lg overflow-hidden">
                  {draft.lines.map((l, i) => (
                    <div key={i} className="p-3 border-b border-navy-800 last:border-0 flex justify-between gap-3 text-sm">
                      <span className="text-muted flex-1">{l.description}</span>
                      <span className="font-medium text-ink flex-shrink-0">{money(l.amount)}</span>
                    </div>
                  ))}
                  <div className="p-3 bg-navy-800 flex justify-between font-semibold text-ink">
                    <span>Total</span>
                    <span>{money(draft.total)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-faint bg-navy-950 border border-navy-800 rounded-lg p-4">
                  {draft.hasRates
                    ? 'No billable tracked usage inside this zone for the selected period.'
                    : 'No cost rates set. Add hourly / mileage / daily rates on your assets (Assets → Edit → Cost structure) so usage can be priced.'}
                </p>
              )
            )}

            {pushed && (
              <div className="text-center py-4 space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#34d399]/15 grid place-items-center mx-auto">
                  <Check className="h-6 w-6 text-[#34d399]" />
                </div>
                <p className="font-semibold text-ink">Invoice {pushed.docNumber} created · {money(pushed.total)}</p>
                <a
                  href={pushed.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-teal hover:underline"
                >
                  Open in QuickBooks <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <p className="text-xs text-faint">Created as a draft — review and send it from QuickBooks.</p>
              </div>
            )}

            {error && (
              <p className="text-xs text-alert bg-alert/10 border border-alert/30 rounded-lg p-3">
                {error}
                {/* In-app support path — also the answer to Intuit's "can
                    customers reach you from within the app" question. */}
                <span className="block mt-1.5 text-muted">
                  Stuck? Email <a href="mailto:support@hammertrack.ai" className="text-teal hover:underline">support@hammertrack.ai</a> and include this message.
                </span>
              </p>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={closeReal}>
                <X className="h-4 w-4 mr-1" /> {pushed ? 'Done' : 'Cancel'}
              </Button>
              {!pushed && (
                <Button
                  className="flex-1"
                  disabled={loading || pushing || !draft || draft.lines.length === 0}
                  onClick={push}
                >
                  {pushing
                    ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating…</>
                    : <><Check className="h-4 w-4 mr-1" /> Create in QuickBooks</>}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
