/**
 * The nightly read of a company's QuickBooks (migration 167) — server only,
 * service role. One pull = the chart of accounts, AR / AP aging, 12 months of
 * P&L by month and the last 60 days of deposits, parsed by lib/books/report.ts
 * into one bounded `books_snapshots` row (or the error, when it fails). Reuses
 * lib/qbo.ts for the connection: `getLiveConnection` refreshes the access
 * token and stores the rotated refresh token, which is also what keeps the
 * connection alive (Intuit's refresh token lapses ~100 days after its last use).
 * Read-only against QuickBooks: nothing here writes to the company's books.
 */
import { getLiveConnection, qboFetch, qboQuery, type LiveConnection } from '@/lib/qbo'
import { parseAccounts, parseAging, parseDeposits, parsePnl, type BooksSnapshot } from './report'

const DAY = 86_400_000
export const KEEP_SNAPSHOTS = 60
/** Comfortably under the table's 400 kB CHECK. */
const MAX_BYTES = 300_000

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

async function part<T>(missing: string[], name: string, run: () => Promise<T>): Promise<T | null> {
  try { return await run() } catch (err) {
    missing.push(name)
    console.error('books pull: part failed', name, err instanceof Error ? err.message.slice(0, 200) : err)
    return null
  }
}

export async function readBooks(conn: LiveConnection, now = Date.now()): Promise<BooksSnapshot> {
  const today = dayOf(now)
  const d = new Date(now)
  const pnlStart = dayOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 11, 1))
  const depSince = dayOf(now - 60 * DAY)
  const missing: string[] = []
  const [acc, ar, ap, pnl, dep] = await Promise.all([
    part(missing, 'accounts', () => qboQuery(conn, 'SELECT * FROM Account MAXRESULTS 1000')),
    part(missing, 'receivables', () => qboFetch(conn, `/reports/AgedReceivables?report_date=${today}`)),
    part(missing, 'payables', () => qboFetch(conn, `/reports/AgedPayables?report_date=${today}`)),
    part(missing, 'profit and loss', () => qboFetch(conn, `/reports/ProfitAndLoss?start_date=${pnlStart}&end_date=${today}&summarize_column_by=Month`)),
    part(missing, 'deposits', () => qboQuery(conn, `SELECT * FROM Deposit WHERE TxnDate >= '${depSince}' ORDERBY TxnDate DESC MAXRESULTS 200`)),
  ])
  const p = pnl ? parsePnl(pnl) : { months: [], accounts: [] }
  const snap: BooksSnapshot = {
    takenAt: new Date(now).toISOString(),
    accounts: acc ? parseAccounts(acc) : [],
    ar: ar ? parseAging(ar) : null,
    ap: ap ? parseAging(ap) : null,
    pnl: p.months,
    pnlAccounts: p.accounts,
    deposits: dep ? parseDeposits(dep) : [],
    missing,
  }
  // Belt: the parsers cap every list, but never store past the bound.
  while (JSON.stringify(snap).length > MAX_BYTES && snap.deposits.length) snap.deposits = snap.deposits.slice(0, Math.floor(snap.deposits.length / 2))
  while (JSON.stringify(snap).length > MAX_BYTES && snap.pnlAccounts.length) snap.pnlAccounts = snap.pnlAccounts.slice(0, Math.floor(snap.pnlAccounts.length / 2))
  return snap
}

export type PullResult = { ok: true; takenAt: string; missing: string[] } | { ok: false; error: string; stored: boolean }

/** Pull one company's books and store the snapshot (or the error). Prunes to the newest 60. */
export async function pullBooks(companyId: string): Promise<PullResult> {
  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  let conn: LiveConnection | null = null
  try {
    conn = await getLiveConnection(companyId)
  } catch (err) {
    const error = `Couldn’t reach QuickBooks: ${err instanceof Error ? err.message : 'sign-in failed'}`.slice(0, 480)
    const { error: e } = await db.from('books_snapshots').insert({ company_id: companyId, source: 'qbo', error })
    return { ok: false, error, stored: !e }
  }
  if (!conn) return { ok: false, error: 'QuickBooks isn’t connected.', stored: false }

  let snap: BooksSnapshot
  try {
    snap = await readBooks(conn)
  } catch (err) {
    snap = { takenAt: new Date().toISOString(), accounts: [], ar: null, ap: null, pnl: [], pnlAccounts: [], deposits: [], missing: ['everything'] }
    console.error('books pull failed', companyId, err)
  }
  const allMissing = snap.missing.length >= 5 || snap.missing.includes('everything')
  const row: { company_id: string; source: 'qbo'; taken_at: string; data?: BooksSnapshot; error: string | null } = allMissing
    ? { company_id: companyId, source: 'qbo', taken_at: snap.takenAt, error: 'QuickBooks didn’t answer any of the reads — try again later.' }
    : { company_id: companyId, source: 'qbo', taken_at: snap.takenAt, data: snap, error: snap.missing.length ? `Didn’t come back: ${snap.missing.join(', ')}` : null }
  const { error: insErr } = await db.from('books_snapshots').insert(row)
  if (insErr) return { ok: false, error: 'Couldn’t store the snapshot.', stored: false }

  // Keep the newest 60.
  const { data: old } = await db.from('books_snapshots').select('id').eq('company_id', companyId)
    .order('taken_at', { ascending: false }).range(KEEP_SNAPSHOTS, KEEP_SNAPSHOTS + 500)
  const ids = (old ?? []).map((r) => String(r.id))
  if (ids.length) await db.from('books_snapshots').delete().in('id', ids).eq('company_id', companyId)

  return allMissing ? { ok: false, error: row.error as string, stored: true } : { ok: true, takenAt: snap.takenAt, missing: snap.missing }
}
