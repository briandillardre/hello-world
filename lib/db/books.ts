/**
 * The books reads (migration 167): the newest QuickBooks snapshot and the
 * month-end close records — through the caller's RLS, which already limits
 * both to costs logins at Admin or the Master. Demo mode returns a fictional
 * company's books (the demo is a public surface — every name is made up),
 * dated relative to today so it never goes stale.
 */
import type { BooksSnapshot } from '@/lib/books/report'
import { addMonths, CLOSE_STEPS, dueOn, monthStart, type CloseRecord, type SignRole } from '@/lib/books/close'
import { dayKey } from '@/lib/dates'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const DAY = 86_400_000
export const BOOKS_TZ = 'America/New_York'

export interface SnapshotRow {
  takenAt: string
  data: BooksSnapshot | null
  error: string | null
}

/** The newest snapshot, and the newest one that has data (they differ when last night's pull failed). */
export async function getLatestBooks(companyId: string): Promise<{ available: boolean; latest: SnapshotRow | null; good: SnapshotRow | null }> {
  if (isMock) { const s = demoSnapshot(); return { available: true, latest: s, good: s } }
  const { createClient } = await import('@/lib/supabase-server')
  const sb = createClient()
  const { data, error } = await sb.from('books_snapshots').select('taken_at, data, error')
    .eq('company_id', companyId).order('taken_at', { ascending: false }).limit(5)
  if (error) return { available: false, latest: null, good: null }
  const rows: SnapshotRow[] = (data ?? []).map((r) => ({ takenAt: String(r.taken_at), data: (r.data as BooksSnapshot | null) ?? null, error: (r.error as string | null) ?? null }))
  let good = rows.find((r) => r.data) ?? null
  if (!good && rows.length) {
    const { data: g } = await sb.from('books_snapshots').select('taken_at, data, error').eq('company_id', companyId)
      .not('data', 'is', null).order('taken_at', { ascending: false }).limit(1).maybeSingle()
    good = g ? { takenAt: String(g.taken_at), data: g.data as BooksSnapshot, error: (g.error as string | null) ?? null } : null
  }
  return { available: true, latest: rows[0] ?? null, good }
}

const toRecord = (r: Record<string, unknown>): CloseRecord => ({
  month: monthStart(String(r.month)) ?? String(r.month),
  items: (r.items && typeof r.items === 'object' ? r.items : {}) as CloseRecord['items'],
  signedBy: (r.signed_by as string | null) ?? null,
  signedName: (r.signed_name as string | null) ?? null,
  signedRole: (r.signed_role as SignRole | null) ?? null,
  signedAt: (r.signed_at as string | null) ?? null,
  note: (r.note as string | null) ?? null,
})

/** The last two years of closes, newest first. */
export async function getCloses(companyId: string): Promise<{ available: boolean; records: CloseRecord[] }> {
  if (isMock) return { available: true, records: demoCloses() }
  const { createClient } = await import('@/lib/supabase-server')
  const { data, error } = await createClient().from('books_closes')
    .select('month, items, signed_by, signed_name, signed_role, signed_at, note')
    .eq('company_id', companyId).order('month', { ascending: false }).limit(24)
  if (error) return { available: false, records: [] }
  return { available: true, records: (data ?? []).map((r) => toRecord(r as Record<string, unknown>)) }
}

// ── Demo (fiction) ──────────────────────────────────────────────────────────

const today = () => dayKey(Date.now(), BOOKS_TZ)
const back = (n: number) => new Date(Date.parse(`${today()}T12:00:00Z`) - n * DAY).toISOString().slice(0, 10)

export function demoSnapshot(): SnapshotRow {
  const t = today()
  const takenAt = `${t}T07:17:00.000Z`
  const cur = `${t.slice(0, 7)}-01`
  const pnl = Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(cur, i - 11).slice(0, 7)
    const season = [0.6, 0.65, 0.85, 1, 1.1, 1.15, 1.1, 1.1, 1.05, 1, 0.85, 0.7][Number(month.slice(5, 7)) - 1]
    const income = Math.round(205_000 * season)
    const cogs = Math.round(income * 0.68)
    const expense = 31_000
    return { month, income, cogs, expense, net: income - cogs - expense }
  })
  return {
    takenAt,
    error: null,
    data: {
      takenAt,
      accounts: [
        { id: '35', name: 'Operating Checking', type: 'Bank', subType: 'Checking', balance: 184_220.41, active: true },
        { id: '36', name: 'Payroll Checking', type: 'Bank', subType: 'Checking', balance: 22_870.0, active: true },
        { id: '37', name: 'Savings', type: 'Bank', subType: 'Savings', balance: 61_500.0, active: true },
        { id: '4', name: 'Undeposited Funds', type: 'Other Current Asset', subType: 'UndepositedFunds', balance: 8_400.0, active: true },
        { id: '84', name: 'Accounts Receivable (A/R)', type: 'Accounts Receivable', subType: 'AccountsReceivable', balance: 312_600.0, active: true },
        { id: '33', name: 'Accounts Payable (A/P)', type: 'Accounts Payable', subType: 'AccountsPayable', balance: 96_450.0, active: true },
        { id: '41', name: 'Business Card', type: 'Credit Card', subType: 'CreditCard', balance: 14_210.55, active: true },
        { id: '1', name: 'Contract Revenue', type: 'Income', subType: 'ServiceFeeIncome', balance: 0, active: true },
        { id: '2', name: 'Uncategorized Income', type: 'Income', subType: 'ServiceFeeIncome', balance: 0, active: true },
        { id: '3', name: 'Uncategorized Expense', type: 'Expense', subType: 'OtherMiscellaneousServiceCost', balance: 0, active: true },
        { id: '60', name: 'Fuel', type: 'Expense', subType: 'Auto', balance: 0, active: true },
        { id: '61', name: 'Owner Draws', type: 'Expense', subType: 'OtherMiscellaneousServiceCost', balance: 0, active: true },
        { id: '70', name: 'Materials', type: 'Cost of Goods Sold', subType: 'SuppliesMaterialsCogs', balance: 0, active: true },
      ],
      ar: {
        buckets: { current: 184_000, d30: 61_200, d60: 22_400, d90: 18_000, over90: 27_000 },
        total: 312_600, pastDue: 128_600, over60: 45_000,
        top: [
          { name: 'Harbor Point Builders', total: 142_000, over60: 0 },
          { name: 'Tri-County Schools', total: 88_600, over60: 27_000 },
          { name: 'Maple Street Partners', total: 51_000, over60: 18_000 },
        ],
      },
      ap: {
        buckets: { current: 71_250, d30: 18_900, d60: 6_300, d90: 0, over90: 0 },
        total: 96_450, pastDue: 25_200, over60: 0,
        top: [
          { name: 'Palmetto Aggregates', total: 41_800, over60: 0 },
          { name: 'Ridgeline Rentals', total: 22_150, over60: 0 },
        ],
      },
      pnl,
      pnlAccounts: [
        { name: 'Contract Revenue', total: pnl.reduce((s, m) => s + m.income, 0) - 6_200 },
        { name: 'Uncategorized Income', total: 6_200 },
        { name: 'Uncategorized Expense', total: 3_940.18 },
        { name: 'Owner Draws', total: 48_000 },
        { name: 'Fuel', total: 61_380 },
      ],
      deposits: [
        { id: '901', date: back(12), total: 96_400, memo: null, lines: [{ amount: 96_400, accountId: null, accountName: null, payee: 'Harbor Point Builders', memo: 'Pay app 4' }] },
        { id: '902', date: back(27), total: 40_000, memo: 'SBA line of credit draw', lines: [{ amount: 40_000, accountId: '1', accountName: 'Contract Revenue', payee: null, memo: 'Loan advance' }] },
        { id: '903', date: back(33), total: 1_250, memo: null, lines: [{ amount: 1_250, accountId: '1', accountName: 'Contract Revenue', payee: 'Supply house', memo: 'Refund' }] },
      ],
      missing: [],
    },
  }
}

function demoCloses(): CloseRecord[] {
  const t = today()
  const cur = `${t.slice(0, 7)}-01`
  const tick = (day: string) => ({ by: null, name: 'Dana Whitfield', at: `${day}T15:00:00.000Z`, note: null })
  const out: CloseRecord[] = []
  // The month now closing: four steps in.
  const now = Number(t.slice(8, 10)) <= 10 ? addMonths(cur, -1) : cur
  out.push({ month: now, items: Object.fromEntries(CLOSE_STEPS.slice(0, 4).map((s) => [s.key, tick(back(2))])), signedBy: null, signedName: null, signedRole: null, signedAt: null, note: null })
  // Three before it, signed on time (the 7th–9th of the month after).
  for (let i = 1; i <= 3; i++) {
    const m = addMonths(now, -i)
    const signDay = dueOn(m).slice(0, 8) + String(10 - i).padStart(2, '0')
    out.push({ month: m, items: Object.fromEntries(CLOSE_STEPS.map((s) => [s.key, tick(signDay)])), signedBy: null, signedName: 'Dana Whitfield', signedRole: 'bookkeeper', signedAt: `${signDay}T20:00:00.000Z`, note: null })
  }
  return out
}
