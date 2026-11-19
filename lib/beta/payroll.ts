/**
 * Certified payroll — pure. One job, one payroll week, the WH-347 layout:
 * each worker's classification, hours on THIS project by day (straight and
 * overtime), the rate paid, gross for this project and for all work that
 * week, and the prevailing-wage check (base + fringe paid ≥ the wage
 * decision's for the classification).
 *
 * Hours come from the time clock — the same GPS-verified entries /timecards
 * shows, clocked to the job's site. Overtime is the federal rule (Contract
 * Work Hours and Safety Standards Act): hours past 40 in the WORKWEEK across
 * ALL the person's work, paid at 1.5 × the BASE rate; fringe is never
 * multiplied. A project's share of the week's OT is the hours worked on it
 * after the 40th hour, in time order.
 *
 * Deductions (FICA, withholding) stay blank: they live in the payroll
 * company's books, and the form says so rather than inventing them.
 */

export interface Entry { userId: string; zoneId: string | null; inAt: string; outAt: string | null; paidHours: number }
export interface WorkerClass { userId: string; name: string; classification: string; idLast4?: string; base: number; fringeCash?: number; fringePlan?: number; apprentice?: boolean }
export interface WageRate { classification: string; base: number; fringe?: number; decision?: string }

export interface PayrollLine {
  userId: string
  name: string
  idLast4: string | null
  classification: string | null
  /** Seven days, Sunday first: [straight, overtime] hours on this project. */
  days: [number, number][]
  st: number
  ot: number
  /** Hours at every job that week (the OT basis). */
  allHours: number
  rateSt: number | null
  rateOt: number | null
  fringeCash: number
  fringePlan: number
  grossProject: number | null
  grossAll: number | null
  required: { base: number; fringe: number } | null
  /** Short sentences: missing class, under-paid, apprentice note. */
  problems: string[]
}

const round2 = (n: number) => Math.round(n * 100) / 100
/** Normalise a classification for matching ("Operator - Excavator" = "operator: excavator"). */
export const classKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The Sunday (YYYY-MM-DD) that begins the week holding `day`. */
export function weekStart(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`)
  const w = new Date(t).getUTCDay()
  return new Date(t - w * 86_400_000).toISOString().slice(0, 10)
}
export const weekEnding = (start: string) => new Date(Date.parse(`${start}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10)

/**
 * Build the week's lines for one job site. `entries` are ALL the week's
 * closed entries for the workers (every site) — the OT basis needs them;
 * `dayOf` turns a clock-in into the company's local YYYY-MM-DD.
 */
export function buildPayroll(opts: {
  zoneId: string
  weekStart: string
  entries: Entry[]
  classes: WorkerClass[]
  rates: WageRate[]
  names: Map<string, string>
  dayOf: (iso: string) => string
}): PayrollLine[] {
  const { zoneId, entries, classes, rates, names, dayOf } = opts
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${opts.weekStart}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))
  const inWeek = entries.filter((e) => e.outAt && days.includes(dayOf(e.inAt)) && e.paidHours > 0)
  const workers = Array.from(new Set(inWeek.filter((e) => e.zoneId === zoneId).map((e) => e.userId)))
  const byClass = new Map(rates.map((r) => [classKey(r.classification), r]))
  const out: PayrollLine[] = []
  for (const userId of workers) {
    const mine = inWeek.filter((e) => e.userId === userId).sort((a, b) => Date.parse(a.inAt) - Date.parse(b.inAt))
    const cls = classes.find((c) => c.userId === userId) ?? null
    const d: [number, number][] = days.map(() => [0, 0])
    let running = 0
    let allHours = 0
    for (const e of mine) {
      const h = e.paidHours
      const stPart = Math.max(0, Math.min(h, 40 - running))
      const otPart = h - stPart
      running += h
      allHours += h
      if (e.zoneId !== zoneId) continue
      const i = days.indexOf(dayOf(e.inAt))
      d[i][0] += stPart
      d[i][1] += otPart
    }
    const daysR = d.map(([s, o]) => [round2(s), round2(o)] as [number, number])
    const st = round2(daysR.reduce((t, x) => t + x[0], 0))
    const ot = round2(daysR.reduce((t, x) => t + x[1], 0))
    const problems: string[] = []
    const req = cls ? byClass.get(classKey(cls.classification)) ?? null : null
    if (!cls) problems.push('No payroll class — set the classification and rate under Certified payroll → Crew.')
    else if (!req && rates.length) problems.push(`"${cls.classification}" is not on this job's wage decision.`)
    const rateSt = cls ? round2(cls.base) : null
    const rateOt = cls ? round2(cls.base * 1.5) : null
    const fringeCash = cls ? round2(cls.fringeCash ?? 0) : 0
    const fringePlan = cls ? round2(cls.fringePlan ?? 0) : 0
    if (cls && req) {
      const paid = cls.base + (cls.fringeCash ?? 0) + (cls.fringePlan ?? 0)
      const owed = req.base + (req.fringe ?? 0)
      if (cls.base < req.base && !cls.apprentice) problems.push(`Base $${cls.base.toFixed(2)} is under the decision's $${req.base.toFixed(2)}.`)
      if (paid + 0.004 < owed && !cls.apprentice) problems.push(`Base + fringe $${paid.toFixed(2)} is under the required $${owed.toFixed(2)} — $${(owed - paid).toFixed(2)}/hr short.`)
      if (cls.apprentice) problems.push('Apprentice — pay at the registered program\'s ratio; attach the program papers.')
    }
    const gross = (sth: number, oth: number) => (cls ? round2(sth * (cls.base + (cls.fringeCash ?? 0)) + oth * (cls.base * 1.5 + (cls.fringeCash ?? 0))) : null)
    const allSt = Math.min(40, allHours)
    out.push({
      userId, name: cls?.name ?? names.get(userId) ?? 'Crew', idLast4: cls?.idLast4 ?? null, classification: cls?.classification ?? null,
      days: daysR, st, ot, allHours: round2(allHours), rateSt, rateOt, fringeCash, fringePlan,
      grossProject: gross(st, ot), grossAll: gross(allSt, Math.max(0, allHours - 40)),
      required: req ? { base: req.base, fringe: req.fringe ?? 0 } : null, problems,
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s
}

/** LCPtracker-style import rows: a header, then one row per worker per day worked. */
export function lcpRows(lines: PayrollLine[], weekStartDay: string, project: { number: string | null; name: string }): (string | number)[][] {
  const rows: (string | number)[][] = [['Project', 'Project Name', 'Week Ending', 'Employee', 'ID Last 4', 'Classification', 'Date', 'ST Hours', 'OT Hours', 'ST Rate', 'OT Rate', 'Fringe Cash', 'Fringe Plan']]
  for (const l of lines) {
    l.days.forEach(([s, o], i) => {
      if (!s && !o) return
      const day = new Date(Date.parse(`${weekStartDay}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
      rows.push([project.number ?? '', project.name, weekEnding(weekStartDay), l.name, l.idLast4 ?? '', l.classification ?? '', day, s, o, l.rateSt ?? '', l.rateOt ?? '', l.fringeCash, l.fringePlan])
    })
  }
  return rows
}

/** The same rows as CSV (formula-looking cells defused). */
export function lcpCsv(lines: PayrollLine[], weekStartDay: string, project: { number: string | null; name: string }): string {
  return lcpRows(lines, weekStartDay, project).map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
}

/** One line per worker for the form's summary + the week's totals. */
export function payrollTotals(lines: PayrollLine[]): { st: number; ot: number; gross: number | null; problems: number } {
  let gross: number | null = 0
  for (const l of lines) gross = gross === null || l.grossProject === null ? null : gross + l.grossProject
  return {
    st: round2(lines.reduce((t, l) => t + l.st, 0)),
    ot: round2(lines.reduce((t, l) => t + l.ot, 0)),
    gross: gross === null ? null : round2(gross),
    problems: lines.reduce((t, l) => t + l.problems.length, 0),
  }
}
