import Link from 'next/link'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions, requireFeature } from '@/lib/permissions-server'
import { rankOf, RANK } from '@/lib/permissions'
import { getConnectionStatus, isQboConfigured, isQboSandbox } from '@/lib/qbo'
import { BOOKS_TZ, getCloses, getLatestBooks } from '@/lib/db/books'
import { booksAudit } from '@/lib/books/audit'
import { cashInBank } from '@/lib/books/report'
import { closeMonthFor, closeState, dueWords, monthWords, onTimeStreak } from '@/lib/books/close'
import { CloseChecklist, RefreshBooks } from '@/components/finance/BooksClose'

export const metadata = { title: 'HammerTrack — Month-end close' }
export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const card = 'rounded-xl border border-navy-800 bg-navy-900/60 p-3'
const money = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const stamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: BOOKS_TZ })

/**
 * Books closed by the 10th (migration 167): this month's close as a checklist
 * the owner, bookkeeper or CPA signs off, the on-time streak, and what the
 * nightly QuickBooks read found. Owner books: costs AND Admin or the Master.
 */
export default async function ClosePage() {
  await requireFeature('finance')
  const perms = await getMyPermissions()
  if (!perms.canViewCosts || rankOf(perms) < RANK.admin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-6 text-center">
          The month-end close is visible to the owner and Admins with the cost permission (Team page).
        </p>
      </div>
    )
  }

  const companyId = await getCurrentCompanyId()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: BOOKS_TZ })
  const [books, closes, conn] = await Promise.all([
    getLatestBooks(companyId),
    getCloses(companyId),
    isMock ? Promise.resolve({ connected: true, demo: true }) : isQboConfigured ? getConnectionStatus(companyId) : Promise.resolve({ connected: false, demo: false }),
  ])
  const connected = conn.connected
  const month = closeMonthFor(today, closes.records)
  const record = closes.records.find((r) => r.month === month) ?? null
  const st = closeState(month, record, today, BOOKS_TZ)
  const streak = onTimeStreak(closes.records, today, BOOKS_TZ)
  const snap = books.good?.data ?? null
  const findings = booksAudit(snap, today)
  const cash = cashInBank(snap)
  // A newer read that failed outright (a partial read shows its gaps below).
  const lastFailed = books.latest && !books.latest.data ? books.latest : null
  const canWrite = perms.canEdit && !perms.viewingAs && !isMock

  let defaultName = ''
  if (!isMock) {
    const { createClient } = await import('@/lib/supabase-server')
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (user) {
      const { data: me } = await sb.from('profiles').select('name').eq('id', user.id).maybeSingle()
      defaultName = (me?.name as string | null) ?? ''
    }
  }

  const statusWords = st.signed
    ? (st.status === 'on_time' ? 'Signed off on time' : 'Signed off late')
    : st.status === 'late' ? `Late — was due ${dueWords(st.due)}`
      : st.daysLeft === 0 ? 'Due today' : `Due ${dueWords(st.due)} · ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left`
  const tone = st.status === 'late' ? 'text-red-300' : st.signed ? 'text-teal' : st.daysLeft <= 3 ? 'text-amber' : 'text-muted'

  return (
    <div className="h-full overflow-auto pb-[54px] md:pb-20"><div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div>
        <Link href="/finance" className="text-[12px] text-teal">← Financials</Link>
        <h1 className="font-display font-bold text-xl text-ink">Month-end close</h1>
        <p className="text-[12.5px] text-faint">Books closed by the 10th: every step ticked, signed by the owner, the bookkeeper or the CPA.{isMock ? ' Demo numbers.' : ''}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className={card}>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{monthWords(month)} close</p>
          <p className="font-mono text-[18px] font-bold text-ink">{st.done} of {st.total}</p>
          <p className={`text-[11.5px] ${tone}`}>{statusWords}</p>
        </div>
        <div className={card}>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">On time in a row</p>
          <p className={`font-mono text-[18px] font-bold ${streak > 0 ? 'text-teal' : 'text-ink'}`}>{streak} month{streak === 1 ? '' : 's'}</p>
          <p className="text-[11.5px] text-muted">signed by the 10th</p>
        </div>
        <div className={card + ' col-span-2 sm:col-span-1'}>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Cash in the bank</p>
          <p className="font-mono text-[18px] font-bold text-ink">{cash ? money(cash.total) : '—'}</p>
          <p className="text-[11.5px] text-muted">{cash && books.good ? `QuickBooks, as of ${stamp(books.good.takenAt)}` : connected ? 'waits on the first read' : 'connect QuickBooks'}</p>
        </div>
      </div>

      {!closes.available && <p className="text-[12px] text-amber">The close records didn’t load — try again in a minute.</p>}
      <CloseChecklist key={month} month={month} monthLabel={monthWords(month)} record={record} canWrite={canWrite} defaultName={defaultName} />

      <section className={card + ' space-y-2'} aria-labelledby="books-findings">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="books-findings" className="text-[13px] font-semibold text-ink">
            What the books show {isQboSandbox && connected && !isMock && <span className="ml-1 rounded border border-amber/50 px-1.5 py-0.5 font-mono text-[10px] text-amber">SANDBOX</span>}
          </h2>
          {books.good && <p className="text-[11.5px] text-faint">from QuickBooks, as of {stamp(books.good.takenAt)}</p>}
        </div>

        {!connected ? (
          <div className="space-y-1">
            <p className="text-[12.5px] text-muted">QuickBooks isn’t connected, so there’s nothing to read yet. The checklist above still works.</p>
            <Link href="/accounting" className="text-[12.5px] text-teal">Connect QuickBooks →</Link>
          </div>
        ) : !snap ? (
          <p className="text-[12.5px] text-muted">No read yet — it runs every night, or read it now.</p>
        ) : findings.length === 0 ? (
          <p className="text-[12.5px] text-teal">Nothing to fix: no catch-all money, no bank below zero, nothing badly late.</p>
        ) : (
          <ul className="space-y-2">
            {findings.map((f) => (
              <li key={f.key} className="flex gap-2">
                <span className={'mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ' + (f.severity === 'fix' ? 'bg-red-500/15 text-red-300' : 'bg-amber/15 text-amber')}>{f.severity === 'fix' ? 'Fix' : 'Look'}</span>
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink">{f.words}</p>
                  {f.examples?.length ? <p className="text-[11.5px] text-faint">{f.examples.join(' · ')}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {snap?.missing?.length ? <p className="text-[11.5px] text-amber">Didn’t come back on that read: {snap.missing.join(', ')}.</p> : null}
        {lastFailed?.error && <p className="text-[11.5px] text-amber">Last read {stamp(lastFailed.takenAt)}: {lastFailed.error}</p>}
        {connected && <RefreshBooks disabled={!canWrite} />}
        <p className="text-[11px] text-faint">HammerTrack only reads QuickBooks — nothing here changes your books.</p>
      </section>
    </div></div>
  )
}
