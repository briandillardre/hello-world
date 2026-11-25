/**
 * The owner dashboard — pure. One page that answers what the owner asks every
 * week: what's owed to us, what we owe, how much work is booked, how the bids
 * are going, who we depend on, where the money goes, and what the company is
 * worth with the discounts a buyer would take. Every number comes from the
 * app's own records (pay apps, job cost, supplier invoices, estimates and the
 * bid history) — never from a guess. Where a number is missing the result
 * says so instead of showing zero.
 *
 * Shared by /finance and `scripts/owner-test.mjs`.
 */

export interface OwnerJob { jobId: string; name: string; customer: string | null; stage: string; contract: number | null; awardedOn: string | null }
export interface OwnerWip { jobId: string; contract: number; earned: number; billed: number; costToDate: number; known: boolean }
export interface OwnerBid { estimateId: string; status: 'draft' | 'sent' | 'won' | 'lost'; bidOn: string | null; total: number | null }
export interface CostSplit { pcat: 'L' | 'M' | 'S' | 'E' | 'F' | 'R' | 'O'; amount: number }

/** Stages that hold booked work. */
export const BOOKED = ['awarded', 'active', 'on_hold', 'substantial'] as const

const r2 = (v: number) => Math.round(v * 100) / 100
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0)

// ── Backlog ─────────────────────────────────────────────────────────────────

export interface Backlog { total: number; jobs: { jobId: string; name: string; left: number }[]; unknown: string[] }

/**
 * Work booked but not yet done: each won, running job's contract (to date,
 * when a pay app carries the change orders) less what's earned. A job with no
 * contract amount is named, never counted as zero.
 */
export function backlog(jobs: OwnerJob[], wip: OwnerWip[]): Backlog {
  const byJob = new Map(wip.map((w) => [w.jobId, w]))
  const rows: Backlog['jobs'] = []
  const unknown: string[] = []
  for (const j of jobs) {
    if (!(BOOKED as readonly string[]).includes(j.stage)) continue
    const w = byJob.get(j.jobId)
    const contract = w?.contract || j.contract
    if (!contract) { unknown.push(j.name); continue }
    // earned only counts when the job's % complete can be measured; billed is the floor otherwise
    const done = w ? (w.known ? w.earned : w.billed) : 0
    rows.push({ jobId: j.jobId, name: j.name, left: r2(Math.max(0, contract - done)) })
  }
  rows.sort((a, b) => b.left - a.left)
  return { total: r2(sum(rows.map((r) => r.left))), jobs: rows, unknown }
}

// ── Bids ────────────────────────────────────────────────────────────────────

export interface BidFunnel { sent: number; won: number; lost: number; pending: number; winRate: number | null; wonDollars: number; lostDollars: number; dollarWinRate: number | null }

/** Bids that went out in the window (by bid date), and how they turned out. */
export function bidFunnel(bids: OwnerBid[], from: string, to: string): BidFunnel {
  const inWin = bids.filter((b) => b.status !== 'draft' && b.bidOn && b.bidOn >= from && b.bidOn <= to)
  const won = inWin.filter((b) => b.status === 'won')
  const lost = inWin.filter((b) => b.status === 'lost')
  const decided = won.length + lost.length
  const wonD = sum(won.map((b) => b.total ?? 0)), lostD = sum(lost.map((b) => b.total ?? 0))
  return {
    sent: inWin.length, won: won.length, lost: lost.length, pending: inWin.length - decided,
    winRate: decided ? won.length / decided : null,
    wonDollars: r2(wonD), lostDollars: r2(lostD),
    dollarWinRate: wonD + lostD > 0 ? wonD / (wonD + lostD) : null,
  }
}

// ── Who we depend on ────────────────────────────────────────────────────────

export interface Concentration { customers: { name: string; amount: number; share: number }[]; top: number | null; top3: number | null; hhi: number | null; noCustomer: number }

/**
 * Customer concentration on the contracts awarded in the window (by award
 * date, else all booked work): each customer's share, the top one and the top
 * three, and the Herfindahl index (0–1). Jobs with no customer are counted
 * apart, never lumped into one big "unknown" customer.
 */
export function concentration(jobs: OwnerJob[], from: string | null): Concentration {
  const by = new Map<string, number>()
  let noCustomer = 0
  for (const j of jobs) {
    if (!(BOOKED as readonly string[]).includes(j.stage) && j.stage !== 'closeout' && j.stage !== 'closed') continue
    if (from && j.awardedOn && j.awardedOn < from) continue
    const amt = j.contract ?? 0
    if (!(amt > 0)) continue
    const name = (j.customer ?? '').trim()
    if (!name) { noCustomer += amt; continue }
    const key = name.toLowerCase()
    by.set(key, (by.get(key) ?? 0) + amt)
  }
  const display = new Map<string, string>()
  for (const j of jobs) { const k = j.customer?.trim().toLowerCase(); if (k && !display.has(k)) display.set(k, j.customer!.trim()) }
  const total = sum(Array.from(by.values()))
  const customers = Array.from(by.entries()).map(([k, amount]) => ({ name: display.get(k) ?? k, amount: r2(amount), share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount)
  return {
    customers,
    top: customers.length ? customers[0].share : null,
    top3: customers.length ? sum(customers.slice(0, 3).map((c) => c.share)) : null,
    hhi: customers.length ? sum(customers.map((c) => c.share * c.share)) : null,
    noCustomer: r2(noCustomer),
  }
}

// ── What a buyer would knock off ────────────────────────────────────────────

export interface BooksAnswers {
  /** Books reviewed or compiled by a CPA in the last year. */
  cpaReviewed: boolean | null
  /** Owner's personal spending kept out of the company books. */
  personalSeparate: boolean | null
  /** Revenue booked from pay apps / invoices, not deposits. */
  revenueFromInvoices: boolean | null
}

export interface Discount { key: string; pct: number; why: string }

/**
 * The discounts a buyer applies to a small contractor, each with its reason:
 * customer concentration (from the data) and books a buyer can't rely on
 * (from the owner's answers — an unanswered question costs the discount, the
 * way a buyer reads silence). Capped at 40% together.
 */
export function valuationDiscounts(conc: Concentration, books: BooksAnswers): Discount[] {
  const out: Discount[] = []
  if (conc.top !== null) {
    if (conc.top > 0.5) out.push({ key: 'concentration', pct: 20, why: `One customer is ${Math.round(conc.top * 100)}% of booked work — losing them halves the company.` })
    else if (conc.top > 0.3) out.push({ key: 'concentration', pct: 10, why: `One customer is ${Math.round(conc.top * 100)}% of booked work.` })
  }
  if (books.cpaReviewed !== true) out.push({ key: 'cpa', pct: 10, why: books.cpaReviewed === false ? 'Books aren’t reviewed by a CPA.' : 'Not known whether a CPA reviews the books.' })
  if (books.personalSeparate !== true) out.push({ key: 'personal', pct: 5, why: books.personalSeparate === false ? 'Personal spending runs through the company.' : 'Not known whether personal spending stays out of the books.' })
  if (books.revenueFromInvoices !== true) out.push({ key: 'revenue', pct: 5, why: books.revenueFromInvoices === false ? 'Revenue is booked from deposits, not invoices.' : 'Not known how revenue is booked.' })
  let left = 40
  return out.map((d) => { const pct = Math.min(d.pct, left); left -= pct; return { ...d, pct } }).filter((d) => d.pct > 0)
}

export function applyDiscounts(range: { lo: number; hi: number } | null, discounts: Discount[]): { lo: number; hi: number } | null {
  if (!range) return null
  const k = 1 - sum(discounts.map((d) => d.pct)) / 100
  return { lo: r2(range.lo * k), hi: r2(range.hi * k) }
}

// ── Where the money goes ────────────────────────────────────────────────────

export const PCAT_NAMES: Record<CostSplit['pcat'], string> = {
  L: 'Labor', M: 'Material', S: 'Subcontract', E: 'Equipment & trucking', F: 'Fuel', R: 'Repairs', O: 'Other',
}

export interface SankeyNode { id: string; label: string; col: 0 | 1 | 2; value: number }
export interface SankeyLink { from: string; to: string; value: number }

/**
 * Earned revenue on the running jobs → the company → each cost type and what
 * is left (gross margin, or a loss). Three columns: jobs (the top 6, the rest
 * as "Other jobs"), the company, the uses. Values are dollars; a job with no
 * measurable % complete earns nothing here and is left out.
 */
export function moneySankey(jobs: { name: string; earned: number }[], costs: CostSplit[]): { nodes: SankeyNode[]; links: SankeyLink[]; margin: number } | null {
  const js = jobs.filter((j) => j.earned > 0).sort((a, b) => b.earned - a.earned)
  const earned = sum(js.map((j) => j.earned))
  if (!(earned > 0)) return null
  const top = js.slice(0, 6)
  const rest = sum(js.slice(6).map((j) => j.earned))
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  top.forEach((j, i) => { nodes.push({ id: `j${i}`, label: j.name, col: 0, value: r2(j.earned) }); links.push({ from: `j${i}`, to: 'co', value: r2(j.earned) }) })
  if (rest > 0) { nodes.push({ id: 'jrest', label: `${js.length - 6} other jobs`, col: 0, value: r2(rest) }); links.push({ from: 'jrest', to: 'co', value: r2(rest) }) }
  nodes.push({ id: 'co', label: 'Earned', col: 1, value: r2(earned) })
  const byCat = new Map<string, number>()
  for (const c of costs) if (c.amount > 0) byCat.set(c.pcat, (byCat.get(c.pcat) ?? 0) + c.amount)
  let cost = 0
  for (const [k, v] of Array.from(byCat.entries()).sort((a, b) => b[1] - a[1])) {
    nodes.push({ id: `c${k}`, label: PCAT_NAMES[k as CostSplit['pcat']] ?? k, col: 2, value: r2(v) })
    links.push({ from: 'co', to: `c${k}`, value: r2(v) })
    cost += v
  }
  const margin = r2(earned - cost)
  if (margin > 0) { nodes.push({ id: 'margin', label: 'Gross margin', col: 2, value: margin }); links.push({ from: 'co', to: 'margin', value: margin }) }
  return { nodes, links, margin }
}

/**
 * Lay a three-column Sankey out in a box (pure, for an inline SVG): each
 * column's nodes stacked with a gap, heights by value against the biggest
 * column; each link a band from its source's next free slot to its target's.
 */
export function layoutSankey(s: { nodes: SankeyNode[]; links: SankeyLink[] }, w: number, h: number, opt: { nodeW?: number; gap?: number } = {}) {
  const nodeW = opt.nodeW ?? 12, gap = opt.gap ?? 8
  const cols = [0, 1, 2].map((c) => s.nodes.filter((n) => n.col === c))
  const maxTotal = Math.max(...cols.map((c) => sum(c.map((n) => n.value))), 1)
  const maxCount = Math.max(...cols.map((c) => c.length), 1)
  const k = (h - gap * (maxCount - 1)) / maxTotal
  const xs = [0, (w - nodeW) / 2, w - nodeW]
  const pos = new Map<string, { x: number; y: number; h: number; outY: number; inY: number }>()
  cols.forEach((c, ci) => {
    const colH = sum(c.map((n) => n.value * k)) + gap * (c.length - 1)
    let y = (h - colH) / 2
    for (const n of c) { const nh = Math.max(1, n.value * k); pos.set(n.id, { x: xs[ci], y, h: nh, outY: y, inY: y }); y += nh + gap }
  })
  const bands = s.links.map((l) => {
    const a = pos.get(l.from)!, b = pos.get(l.to)!
    const t = Math.max(1, l.value * k)
    const y0 = a.outY, y1 = b.inY
    a.outY += t; b.inY += t
    const x0 = a.x + nodeW, x1 = b.x, mx = (x0 + x1) / 2
    const d = `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + t} C${mx},${y1 + t} ${mx},${y0 + t} ${x0},${y0 + t} Z`
    return { ...l, d }
  })
  return { nodes: s.nodes.map((n) => ({ ...n, ...pos.get(n.id)! })), bands, nodeW }
}
