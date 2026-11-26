// node scripts/books-test.mjs — the books engine (migration 167): the QuickBooks
// report readers (lib/books/report.ts), the audit (lib/books/audit.ts) and the
// month-end close dates (lib/books/close.ts). Fixtures are shaped like
// Intuit's report JSON — Intuit is never called. Run it after ANY change there.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const load = async (p) => {
  const src = readFileSync(new URL(p, import.meta.url), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
}
const R = await load('../lib/books/report.ts')
const A = await load('../lib/books/audit.ts')
const C = await load('../lib/books/close.ts')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m) } }
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e

// ── Fixtures (Intuit's shapes; names are fiction) ──────────────────────────
const cd = (...v) => ({ ColData: v.map((x) => ({ value: String(x) })) })
const AR = {
  Header: { ReportName: 'AgedReceivables', DateMacro: 'today', ReportBasis: 'Accrual', Currency: 'USD' },
  Columns: { Column: [
    { ColTitle: '', ColType: 'Customer' }, { ColTitle: 'Current', ColType: 'Money' }, { ColTitle: '1 - 30', ColType: 'Money' },
    { ColTitle: '31 - 60', ColType: 'Money' }, { ColTitle: '61 - 90', ColType: 'Money' }, { ColTitle: '91 and over', ColType: 'Money' }, { ColTitle: 'Total', ColType: 'Money' },
  ] },
  Rows: { Row: [
    { ColData: [{ value: 'Harbor Point Builders', id: '58' }, { value: '40000.00' }, { value: '10,000.00' }, { value: '' }, { value: '' }, { value: '' }, { value: '50000.00' }] },
    // A customer with sub-jobs: a section with its own subtotal (must not count twice, must not be the grand total).
    { Header: { ColData: [{ value: 'Tri-County Schools' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }, { value: '' }] },
      Rows: { Row: [cd('Gym addition', '5000', '', '', '8000', '7000', '20000'), cd('Bus lot', '', '', '2000', '', '', '2000')] },
      Summary: cd('Total Tri-County Schools', '5000', '', '2000', '8000', '7000', '22000'), type: 'Section' },
    cd('Maple Street Partners', '', '', '', '', '(500.00)', '-500.00'),
    { Summary: cd('TOTAL', '45000.00', '10000.00', '2000.00', '8000.00', '6500.00', '71500.00'), type: 'Section', group: 'GrandTotal' },
  ] },
}
const AP = {
  Header: { ReportName: 'AgedPayables' },
  Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Current' }, { ColTitle: '1 - 30' }, { ColTitle: '31 - 60' }, { ColTitle: '61 - 90' }, { ColTitle: '91 and over' }, { ColTitle: 'Total' }] },
  Rows: { Row: [cd('Palmetto Aggregates', '12000', '3000', '', '', '', '15000'), cd('Ridgeline Rentals', '', '', '', '1500', '', '1500')] }, // no TOTAL row
}
const mcol = (title, start, end) => ({ ColTitle: title, ColType: 'Money', MetaData: [{ Name: 'StartDate', Value: start }, { Name: 'EndDate', Value: end }] })
const PNL = {
  Header: { ReportName: 'ProfitAndLoss', SummarizeColumnsBy: 'Month', StartPeriod: '2026-09-01', EndPeriod: '2026-11-26' },
  Columns: { Column: [{ ColTitle: '', ColType: 'Account' }, mcol('Sep 2026', '2026-09-01', '2026-09-30'), mcol('Oct 2026', '2026-10-01', '2026-10-31'), { ColTitle: 'Nov 1-26, 2026', ColType: 'Money' }, { ColTitle: 'Total', ColType: 'Money' }] },
  Rows: { Row: [
    { Header: cd('Income', '', '', '', ''), Rows: { Row: [cd('Contract Revenue', '200000', '180000', '150000', '530000'), cd('Uncategorized Income', '', '1200.50', '', '1200.50')] }, Summary: cd('Total Income', '200000.00', '181200.50', '150000.00', '531200.50'), type: 'Section', group: 'Income' },
    { Header: cd('Cost of Goods Sold', '', '', '', ''), Rows: { Row: [cd('Materials', '90000', '80000', '70000', '240000')] }, Summary: cd('Total Cost of Goods Sold', '90000', '80000', '70000', '240000'), type: 'Section', group: 'COGS' },
    { Summary: cd('Gross Profit', '110000', '101200.50', '80000', '291200.50'), type: 'Section', group: 'GrossProfit' },
    { Header: cd('Expenses', '', '', '', ''), Rows: { Row: [cd('Fuel', '5000', '5200', '4800', '15000'), cd('Owner Draws', '4000', '4000', '4000', '12000'), cd('Uncategorized Expense', '', '350', '', '350')] }, Summary: cd('Total Expenses', '9000', '9550', '8800', '27350'), type: 'Section', group: 'Expenses' },
    { Summary: cd('Net Operating Income', '101000', '91650.50', '71200', '263850.50'), type: 'Section', group: 'NetOperatingIncome' },
    { Header: cd('Other Expenses', '', '', '', ''), Rows: { Row: [cd('Interest', '1000', '1000', '1000', '3000')] }, Summary: cd('Total Other Expenses', '1000', '1000', '1000', '3000'), type: 'Section', group: 'OtherExpenses' },
    { Summary: cd('Net Income', '100000.00', '90650.50', '70200.00', '260850.50'), type: 'Section', group: 'NetIncome' },
  ] },
}
const ACCOUNTS = { QueryResponse: { Account: [
  { Id: '35', Name: 'Operating Checking', AccountType: 'Bank', AccountSubType: 'Checking', CurrentBalance: 120000.25, Active: true },
  { Id: '36', Name: 'Payroll Checking', AccountType: 'Bank', AccountSubType: 'Checking', CurrentBalance: -2500, Active: true },
  { Id: '4', Name: 'Undeposited Funds', AccountType: 'Other Current Asset', AccountSubType: 'UndepositedFunds', CurrentBalance: 7400, Active: true },
  { Id: '1', Name: 'Contract Revenue', AccountType: 'Income', AccountSubType: 'ServiceFeeIncome', CurrentBalance: 0, Active: true },
  { Id: '2', Name: 'Uncategorized Income', AccountType: 'Income', CurrentBalance: 0, Active: true },
  { Id: '3', Name: 'Uncategorized Expense', AccountType: 'Expense', CurrentBalance: 0, Active: true },
  { Id: '5', Name: 'Uncategorized Asset', AccountType: 'Other Current Asset', CurrentBalance: 0, Active: true },
  { Id: '6', Name: 'Ask My Accountant', AccountType: 'Expense', CurrentBalance: 0, Active: true },
  { Id: '7', Name: 'Owner Draws', AccountType: 'Expense', CurrentBalance: 0, Active: true },
  { Id: '8', Name: 'Personal Property Tax', AccountType: 'Expense', CurrentBalance: 0, Active: true },
  { Id: '9', Name: "Owner's Equity", AccountType: 'Equity', CurrentBalance: 50000, Active: true },
  { Id: '10', Name: 'Old Savings', AccountType: 'Bank', CurrentBalance: -99, Active: false },
  { Id: '11', Name: 'Fuel', AccountType: 'Expense', CurrentBalance: 0, Active: true },
  { Id: '12', Name: 'Other Income', AccountType: 'Other Income', CurrentBalance: 0, Active: true },
] } }
const TODAY = '2026-11-26'
const dep = (Id, TxnDate, TotalAmt, lines, PrivateNote) => ({ Id, TxnDate, TotalAmt, PrivateNote, DepositToAccountRef: { value: '35' }, Line: lines.map(([Amount, acct, payee, Description]) => ({ Amount, Description, DetailType: 'DepositLineDetail', DepositLineDetail: { ...(acct ? { AccountRef: { value: acct } } : {}), ...(payee ? { Entity: { name: payee, type: 'CUSTOMER' } } : {}) } })) })
const DEPOSITS = { QueryResponse: { Deposit: [
  dep('100', '2026-11-20', 85000, [[85000, '1', 'Harbor Point Builders', 'Pay app 4 — retainage released']]),                // normal customer deposit to income: must NOT fire
  dep('101', '2026-11-02', 40000, [[40000, '1', null, 'SBA loan advance']]),                                                     // loan to income: fires
  dep('102', '2026-10-15', 12000, [[12000, '1', 'Ridgeline Rentals', 'Sale of equipment — 2014 skid steer']]),                   // equipment sale: fires
  dep('103', '2026-11-10', 1200, [[1200, '1', 'Palmetto Aggregates', 'Refund overcharge']]),                                       // small refund: must NOT fire
  dep('104', '2026-08-01', 30000, [[30000, '1', null, 'Line of credit draw']]),                                                  // older than 60 days: must NOT fire
  dep('105', '2026-11-12', 9000, [[9000, '12', null, 'Insurance claim — storm damage']]),                                        // to Other Income, not Income: must NOT fire
  dep('106', '2026-11-14', 20000, [[20000, null, null, 'Transfer from savings']]),                                               // linked payment, no account: must NOT fire
] } }

// ── Parsers ────────────────────────────────────────────────────────────────
ok(R.num('1,234.56') === 1234.56 && R.num('(500.00)') === -500 && R.num('-12') === -12 && R.num('') === null && R.num('abc') === null && R.num('$9') === 9, 'num reads Intuit strings')
const ar = R.parseAging(AR)
ok(ar && ar.total === 71500, `AR grand total from the TOTAL row (${ar?.total})`)
ok(ar.buckets.current === 45000 && ar.buckets.d30 === 10000 && ar.buckets.d60 === 2000 && ar.buckets.d90 === 8000 && ar.buckets.over90 === 6500, 'AR buckets from the TOTAL row')
ok(ar.pastDue === 26500 && ar.over60 === 14500, 'AR past due and over 60')
ok(ar.top[0].name === 'Harbor Point Builders' && ar.top.length === 4, 'top names, largest first; sub-jobs are names, subtotal is not')
ok(!ar.top.some((t) => /^Total/.test(t.name)), 'no subtotal row among the names')
ok(ar.top.find((t) => t.name === 'Gym addition').over60 === 15000, 'a name’s over-60')
ok(ar.top.find((t) => t.name === 'Maple Street Partners').total === -500, 'a credit reads negative')
const ap = R.parseAging(AP)
ok(ap.total === 16500 && ap.pastDue === 4500 && ap.over60 === 1500, `AP with no TOTAL row adds the names (${ap.total}/${ap.pastDue}/${ap.over60})`)
ok(R.parseAging({}) === null && R.parseAging({ Columns: { Column: [{ ColTitle: 'Foo' }] } }) === null, 'not an aging report → null')
ok(R.parseAging({ Columns: AR.Columns }).total === 0, 'an empty aging report → zeros')

const pnl = R.parsePnl(PNL)
ok(pnl.months.length === 3 && pnl.months.map((m) => m.month).join() === '2026-09,2026-10,2026-11', `months from MetaData and a partial-month title (${pnl.months.map((m) => m.month)})`)
const oct = pnl.months[1]
ok(oct.income === 181200.5 && oct.cogs === 80000 && oct.expense === 10550 && oct.net === 90650.5, `Oct P&L (${JSON.stringify(oct)})`)
ok(!pnl.accounts.some((a) => /^Total|Gross Profit|Net/.test(a.name)), 'no summary rows among accounts')
ok(pnl.accounts.find((a) => a.name === 'Uncategorized Income').total === 1200.5, 'an account’s window total from the Total column')
ok(R.parsePnl({}).months.length === 0, 'an empty report → no months')
const noMeta = R.parsePnl({ Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Jan 2026' }, { ColTitle: 'Total' }] }, Rows: { Row: [{ Summary: cd('Net Income', '5', '5'), group: 'NetIncome' }] } })
ok(noMeta.months.length === 1 && noMeta.months[0].month === '2026-01' && noMeta.months[0].net === 5, 'month from the title alone')

const accounts = R.parseAccounts(ACCOUNTS)
ok(accounts.length === 14 && accounts[0].balance === 120000.25 && accounts.find((a) => a.id === '10').active === false, 'accounts')
ok(R.parseAccounts({}).length === 0 && R.parseAccounts({ QueryResponse: {} }).length === 0, 'no accounts')
const deposits = R.parseDeposits(DEPOSITS)
ok(deposits.length === 7 && deposits[1].lines[0].accountId === '1' && deposits[1].lines[0].memo === 'SBA loan advance', 'deposits with lines')
ok(deposits[6].lines[0].accountId === null, 'a linked payment line has no account')
const cash = R.cashInBank({ accounts })
ok(cash.total === 117500.25 && cash.accounts === 2, `cash in the bank: active Bank accounts (${cash.total})`)
ok(R.cashInBank({ accounts: [] }) === null && R.cashInBank(null) === null, 'no bank accounts → null')
const many = { QueryResponse: { Deposit: Array.from({ length: 400 }, (_, i) => dep(String(i), TODAY, 10, Array.from({ length: 40 }, () => [1, '1', null, 'x']))) } }
const capped = R.parseDeposits(many)
ok(capped.length === R.LIMITS.deposits && capped.every((d) => d.lines.length <= R.LIMITS.linesPerDeposit) && capped.reduce((t, d) => t + d.lines.length, 0) <= R.LIMITS.lines, 'deposits are bounded')

// ── Audit ──────────────────────────────────────────────────────────────────
const snap = { takenAt: `${TODAY}T07:17:00Z`, accounts, ar, ap, pnl: pnl.months, pnlAccounts: pnl.accounts, deposits, missing: [] }
const f = A.booksAudit(snap, TODAY)
const by = Object.fromEntries(f.map((x) => [x.key, x]))
ok(by.uncategorized && by.uncategorized.count === 2 && near(by.uncategorized.amount, 1550.5), `uncategorized: income + expense with P&L activity; empty asset and AMA skipped (${by.uncategorized?.count}, ${by.uncategorized?.amount})`)
ok(by.undeposited && by.undeposited.amount === 7400 && by.undeposited.severity === 'fix', 'undeposited funds over $5,000 → fix')
ok(by.negative_bank && by.negative_bank.count === 1 && by.negative_bank.amount === -2500, 'negative bank — the inactive one ignored')
ok(by.non_revenue_deposits && by.non_revenue_deposits.count === 2 && by.non_revenue_deposits.amount === 52000, `loan + equipment sale flagged, nothing else (${by.non_revenue_deposits?.count}, ${by.non_revenue_deposits?.amount})`)
ok(!/Harbor Point|Refund|Insurance|Transfer from savings|Line of credit/i.test(by.non_revenue_deposits.examples.join(' ')), 'normal customer deposit, small refund, other income, old and linked deposits do not fire')
ok(by.owner_draws_as_expense && by.owner_draws_as_expense.count === 1 && by.owner_draws_as_expense.amount === 12000, 'owner draws as expense — property tax and equity are not')
ok(by.ar_over_60 && by.ar_over_60.amount === 14500 && by.ar_over_60.severity === 'fix', 'AR over 60 at 20% → fix')
ok(by.ap_past_due && by.ap_past_due.amount === 4500, 'bills past due')
ok(f[0].severity === 'fix' && f[f.length - 1].severity === 'look', 'fixes first')
ok(f.every((x) => typeof x.words === 'string' && x.words.length > 20 && !/accrual|suspense|journal entry/i.test(x.words)), 'plain words')

// Clean books: nothing fires.
const clean = {
  ...snap,
  accounts: accounts.filter((a) => !/Uncategorized|Ask My|Owner Draws|Undeposited/.test(a.name)).map((a) => (a.type === 'Bank' ? { ...a, balance: Math.abs(a.balance) } : a)),
  ar: { ...ar, buckets: { current: 70000, d30: 1500, d60: 0, d90: 0, over90: 0 }, total: 71500, pastDue: 1500, over60: 0 },
  ap: { ...ap, pastDue: 0, over60: 0 },
  deposits: deposits.filter((d) => d.id === '100' || d.id === '103'),
}
const cf = A.booksAudit(clean, TODAY)
ok(cf.length === 1 && cf[0].key === 'ar_past_due' && cf[0].severity === 'look', `clean books → only a mild past-due look (${cf.map((x) => x.key)})`)
ok(A.booksAudit(null, TODAY).length === 0, 'no snapshot → no findings')
// Uncategorized income with no P&L at all: an income account with no activity read isn't money.
ok(!A.booksAudit({ ...snap, pnlAccounts: [] }, TODAY).some((x) => x.key === 'uncategorized'), 'no P&L read → no catch-all claim on income/expense')
// AR exactly 10% over 60 is not over.
ok(!A.booksAudit({ ...clean, ar: { ...clean.ar, over60: 7150, pastDue: 7150 } }, TODAY).some((x) => x.key === 'ar_over_60'), 'AR at 10% does not fire over-60')
// A deposit of exactly $5,000 is not "over".
ok(!A.booksAudit({ ...clean, deposits: R.parseDeposits({ QueryResponse: { Deposit: [dep('9', '2026-11-20', 5000, [[5000, '1', null, 'Loan']])] } }) }, TODAY).some((x) => x.key === 'non_revenue_deposits'), '$5,000 exactly does not fire')
// A keyword buried inside a longer word (a customer named "Transferworks") is not a match.
ok(!A.booksAudit({ ...clean, deposits: R.parseDeposits({ QueryResponse: { Deposit: [dep('9', '2026-11-20', 9000, [[9000, '1', 'Transferworks LLC', 'Pay app 2']])] } }) }, TODAY).some((x) => x.key === 'non_revenue_deposits'), 'a word inside a name does not fire')

// ── Close ──────────────────────────────────────────────────────────────────
ok(C.CLOSE_STEPS.length === 10 && new Set(C.STEP_KEYS).size === 10, 'ten steps, unique keys')
ok(C.dueOn('2026-11-01') === '2026-12-10' && C.dueOn('2026-12-01') === '2027-01-10', 'November due Dec 10; December due Jan 10')
ok(C.monthStart('2026-11') === '2026-11-01' && C.monthStart('2026-11-19') === '2026-11-01' && C.monthStart('2026-13') === null && C.monthStart('x') === null, 'monthStart')
ok(C.addMonths('2026-01-01', -1) === '2025-12-01' && C.addMonths('2026-11-01', 14) === '2028-01-01', 'addMonths')
const all = Object.fromEntries(C.STEP_KEYS.map((k) => [k, { by: null, name: 'A', at: '2026-12-01T00:00:00Z', note: null }]))
const rec = (month, signedAt, n = 10) => ({ month, items: Object.fromEntries(Object.entries(all).slice(0, n)), signedBy: null, signedName: signedAt ? 'A' : null, signedRole: signedAt ? 'owner' : null, signedAt, note: null })
let st = C.closeState('2026-11-01', rec('2026-11-01', null, 4), '2026-11-26')
ok(st.due === '2026-12-10' && st.status === 'open' && st.done === 4 && st.daysLeft === 14, `November on Nov 26: open, 4 of 10, 14 days (${JSON.stringify(st)})`)
ok(C.closeLine(st) === 'November close: 4 of 10 · due Dec 10', `close line (${C.closeLine(st)})`)
ok(C.closeState('2026-11-01', null, '2026-12-10').status === 'open' && C.closeState('2026-11-01', null, '2026-12-10').daysLeft === 0, 'due day itself is still on time')
ok(C.closeState('2026-11-01', null, '2026-12-11').status === 'late', 'late after the 10th')
ok(C.closeState('2026-11-01', rec('2026-11-01', '2026-12-11T01:30:00Z'), '2026-12-20').status === 'on_time', '9:30 PM Eastern on the 10th is on time (UTC says the 11th)')
ok(C.closeState('2026-11-01', rec('2026-11-01', '2026-12-11T15:00:00Z'), '2026-12-20').status === 'late', 'signed on the 11th → late')
ok(C.closeState('2026-11-01', rec('2026-11-01', '2026-12-11T15:00:00Z'), '2026-12-20', 'UTC').status === 'late', 'tz honoured')
ok(C.closeMonthFor('2026-11-26') === '2026-11-01' && C.closeMonthFor('2026-12-03') === '2026-11-01' && C.closeMonthFor('2026-12-11') === '2026-12-01', 'which month is closing')
ok(C.closeMonthFor('2026-12-03', [rec('2026-11-01', '2026-12-02T15:00:00Z')]) === '2026-12-01', 'last month signed early → this month')
ok(C.stepsDone({ items: { ...all, junk: {} } }) === 10 && C.stepsDone(null) === 0, 'stepsDone counts known steps only')

const recs = [rec('2026-10-01', '2026-11-08T15:00:00Z'), rec('2026-09-01', '2026-10-10T20:00:00Z'), rec('2026-08-01', '2026-09-03T15:00:00Z'), rec('2026-07-01', '2026-08-12T15:00:00Z'), rec('2026-06-01', '2026-07-05T15:00:00Z')]
ok(C.onTimeStreak(recs, '2026-11-26') === 3, `streak: Oct, Sep, Aug on time; Jul late stops it (${C.onTimeStreak(recs, '2026-11-26')})`)
ok(C.onTimeStreak([rec('2026-11-01', null, 4), ...recs], '2026-11-26') === 3, 'an open month not yet due does not break the streak')
ok(C.onTimeStreak(recs, '2026-12-11') === 0, 'November unsigned past the 10th → streak 0')
ok(C.onTimeStreak([rec('2026-11-01', '2026-12-09T15:00:00Z'), ...recs], '2026-12-11') === 4, 'November signed on time extends it')
ok(C.onTimeStreak([], '2026-11-26') === 0, 'no records → 0')
const early = [rec('2026-10-01', null, 6), ...recs.slice(1)]
ok(C.onTimeStreak(early, '2026-11-05') === 2, `on Nov 5 October isn't due yet → Sep + Aug (${C.onTimeStreak(early, '2026-11-05')})`)
ok(C.closeLine(C.closeState('2026-10-01', recs[0], '2026-11-26')) === 'October close: signed off on time', 'signed line')

console.log(`books: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
