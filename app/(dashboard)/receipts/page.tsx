import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/zones'
import { getExpenses, type Expense } from '@/lib/db/expenses'
import { suggestMatchesAction } from '@/lib/actions/expenses'
import { getInstantChaseSetup } from '@/lib/actions/cards'
import { getMyPermissions } from '@/lib/permissions-server'
import { ReceiptsInbox } from '@/components/receipts/ReceiptsInbox'
import { MissingReceipts } from '@/components/receipts/MissingReceipts'
import { InstantChase } from '@/components/receipts/InstantChase'
import type { ReceiptRow } from '@/lib/actions/receipts'

export const metadata = { title: 'HammerTrack — Receipts' }

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Demo mode: show the receipt chase working instead of an empty page —
 *  two swipes already pinged to their cardholders, one imported charge with
 *  no card mapping yet. Display-only; every action returns "Demo mode". */
function demoOpenExpenses(): Expense[] {
  const today = new Date().toISOString().slice(0, 10)
  const base = {
    company_id: 'mock-company-1', category: null, note: null, receipt_id: null,
    status: 'needs_receipt' as const, external_id: null, cardholder_user_id: null,
  }
  return [
    {
      ...base, id: 'demo-exp-1', source: 'card_alert',
      merchant: 'The Home Depot #1123', amount: 214.83, txn_date: today,
      last4: '4821', cardholder_name: 'John',
      chased_at: new Date(Date.now() - 38 * 60000).toISOString(),
      created_at: new Date(Date.now() - 39 * 60000).toISOString(),
    },
    {
      ...base, id: 'demo-exp-2', source: 'card_alert',
      merchant: 'SiteOne Landscape Supply', amount: 187.5, txn_date: today,
      last4: '7310', cardholder_name: 'Sarah',
      chased_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    },
    {
      ...base, id: 'demo-exp-3', source: 'import',
      merchant: 'QuikTrip #1042', amount: 62.15,
      txn_date: new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10),
      last4: '9954', cardholder_name: null, chased_at: null,
      created_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    },
  ]
}

/** Receipts inbox: field photos in, approved QuickBooks expenses out. */
export default async function ReceiptsPage() {
  const companyId = await getCurrentCompanyId()
  let pending: ReceiptRow[] = []
  let done: ReceiptRow[] = []
  let available = false
  const receiptsById: Record<string, { vendor: string | null; amount: number | null; txn_date: string | null; url: string }> = {}
  if (!isMock) {
    try {
      const { createClient } = await import('@/lib/supabase-server')
      const supabase = createClient()
      const { data, error } = await supabase
        .from('receipts')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(200)
      if (!error) {
        available = true
        pending = (data ?? []).filter((r) => r.status === 'pending') as ReceiptRow[]
        done = (data ?? []).filter((r) => r.status !== 'pending').slice(0, 30) as ReceiptRow[]
        for (const r of (data ?? []) as ReceiptRow[]) receiptsById[r.id] = { vendor: r.vendor, amount: r.amount, txn_date: r.txn_date, url: r.url }
      }
    } catch { /* table absent — setup note below */ }
  }

  // Missing receipts — charges without a matching receipt, + suggested matches.
  const openExpenses = available ? await getExpenses(companyId, 'needs_receipt') : isMock ? demoOpenExpenses() : []
  const suggestions = available && openExpenses.length ? await suggestMatchesAction() : {}

  const geofences = await getGeofences(companyId)
  const zoneNames: Record<string, string> = {}
  for (const g of geofences) zoneNames[g.id] = g.name

  const [chase, perms] = await Promise.all([getInstantChaseSetup(), getMyPermissions()])

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20"><div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="font-display font-bold text-xl text-ink">Receipts</h1>
        <p className="text-[12.5px] text-faint">
          Snapped in the field → read by AI → approved by you → posted to QuickBooks. Nothing posts without the ✓.
        </p>
      </div>
      {!available && !isMock ? (
        <div className="rounded-xl border border-navy-700 bg-navy-950 p-8 text-center">
          <p className="text-sm text-muted">
            One quick database update turns the inbox on — run migration{' '}
            <span className="font-mono text-teal">017_receipts.sql</span> in the Supabase SQL Editor.
          </p>
        </div>
      ) : (
        <>
          <InstantChase address={chase.address} cards={chase.cards} members={chase.members} canManage={perms.canManageBilling} />
          <MissingReceipts open={openExpenses} suggestions={suggestions} receiptsById={receiptsById} />
          <ReceiptsInbox pending={pending} done={done} zoneNames={zoneNames} />
        </>
      )}
    </div></div>
  )
}
