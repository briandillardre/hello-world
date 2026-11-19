/**
 * Weather-delay claim packets — pure. A time-extension request lives or dies
 * on proof, day by day: what the weather was AT THE SITE and that the work
 * actually stopped. HammerTrack has both — the site's daily weather (Open-
 * Meteo's archive at the site's centre) and the hours our machines and crew
 * logged there (the hours ledger). A day counts as LOST only when both agree:
 *   - the weather crossed a line (rain ≥ the contract's rain-day amount, the
 *     day after heavy rain (mud), a freeze, high wind), AND
 *   - the site worked under half its normal day (the median of its worked
 *     weekdays in the window).
 * A bad-weather day the crew worked through is listed but never claimed, and
 * the contract's anticipated weather days for each month come off the top —
 * an owner's reviewer checks both, so the packet does first.
 */

export interface WxDay { day: string; precipIn: number | null; gustMph: number | null; tMinF: number | null; tMaxF: number | null }
export interface Thresholds { rainIn: number; mudAfterIn: number; freezeF: number; windMph: number; saturdays: boolean }
export const DEFAULT_THRESHOLDS: Thresholds = { rainIn: 0.5, mudAfterIn: 1.0, freezeF: 32, windMph: 35, saturdays: false }

export interface DayVerdict {
  day: string
  weekday: string
  wx: WxDay | null
  hours: number
  reasons: string[]
  /** weather crossed a line */
  bad: boolean
  /** weather crossed a line AND the site worked under half a normal day */
  lost: boolean
  /** worked through it */
  workedThrough: boolean
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const wday = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`)).getUTCDay()

export function judgeDays(days: string[], wx: Map<string, WxDay>, hours: Map<string, number>, th: Thresholds): { verdicts: DayVerdict[]; normalHours: number } {
  const working = (d: string) => { const w = wday(d); return w >= 1 && w <= 5 ? true : w === 6 && th.saturdays }
  const worked = days.filter((d) => working(d) && (hours.get(d) ?? 0) > 0.5).map((d) => hours.get(d) ?? 0).sort((a, b) => a - b)
  const normalHours = worked.length ? worked[Math.floor(worked.length / 2)] : 0
  const verdicts: DayVerdict[] = []
  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    if (!working(d)) continue
    const w = wx.get(d) ?? null
    const prev = i > 0 ? wx.get(days[i - 1]) ?? null : null
    const reasons: string[] = []
    if (w?.precipIn != null && w.precipIn >= th.rainIn) reasons.push(`${w.precipIn.toFixed(2)}" rain`)
    if (prev?.precipIn != null && prev.precipIn >= th.mudAfterIn && !(w?.precipIn != null && w.precipIn >= th.rainIn)) reasons.push(`saturated ground after ${prev.precipIn.toFixed(2)}" the day before`)
    if (w?.tMaxF != null && w.tMaxF <= th.freezeF) reasons.push(`high of ${Math.round(w.tMaxF)}°F`)
    if (w?.gustMph != null && w.gustMph >= th.windMph) reasons.push(`gusts to ${Math.round(w.gustMph)} mph`)
    const h = Math.round((hours.get(d) ?? 0) * 10) / 10
    const bad = reasons.length > 0
    const lost = bad && (normalHours === 0 ? h === 0 : h < normalHours / 2)
    verdicts.push({ day: d, weekday: WD[wday(d)], wx: w, hours: h, reasons, bad, lost, workedThrough: bad && !lost })
  }
  return { verdicts, normalHours: Math.round(normalHours * 10) / 10 }
}

export interface ClaimSummary { lost: number; anticipated: number; claim: number; byMonth: { month: string; lost: number; anticipated: number; claim: number }[] }

/** Lost days less the contract's anticipated weather days, month by month (never negative). */
export function claimDays(verdicts: DayVerdict[], anticipatedByMonth: Record<string, number>): ClaimSummary {
  const months = new Map<string, number>()
  for (const v of verdicts) if (v.lost) months.set(v.day.slice(0, 7), (months.get(v.day.slice(0, 7)) ?? 0) + 1)
  const all = new Set([...Array.from(months.keys()), ...Array.from(new Set(verdicts.map((v) => v.day.slice(0, 7))))])
  const byMonth = Array.from(all).sort().map((month) => {
    const lost = months.get(month) ?? 0
    const ant = Math.max(0, Math.round(anticipatedByMonth[month] ?? anticipatedByMonth[month.slice(5)] ?? 0))
    return { month, lost, anticipated: ant, claim: Math.max(0, lost - ant) }
  })
  return {
    lost: byMonth.reduce((t, m) => t + m.lost, 0),
    anticipated: byMonth.reduce((t, m) => t + Math.min(m.anticipated, m.lost), 0),
    claim: byMonth.reduce((t, m) => t + m.claim, 0),
    byMonth,
  }
}

const longDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** The request letter — plain words, the evidence table follows it in the packet. */
export function claimLetter(o: {
  companyName: string; jobName: string; jobNumber: string | null; customer: string | null; contractNo: string | null
  from: string; to: string; summary: ClaimSummary; verdicts: DayVerdict[]; normalHours: number; today: string; lat: number; lng: number
}): string {
  const lost = o.verdicts.filter((v) => v.lost)
  const lines = [
    `${longDay(o.today)}`,
    '',
    `To: ${o.customer ?? 'Owner / Contractor'}`,
    `Re: ${o.jobName}${o.jobNumber ? ` (Job ${o.jobNumber})` : ''}${o.contractNo ? ` — Contract ${o.contractNo}` : ''}`,
    `Subject: Request for time extension — weather, ${longDay(o.from)} through ${longDay(o.to)}`,
    '',
    `${o.companyName} requests an extension of ${o.summary.claim} working ${o.summary.claim === 1 ? 'day' : 'days'} to the contract time for weather that stopped the work on this project.`,
    '',
    `Between ${longDay(o.from)} and ${longDay(o.to)}, ${o.summary.lost} working ${o.summary.lost === 1 ? 'day was' : 'days were'} lost to weather at the site. ${o.summary.anticipated ? `The contract anticipates ${o.summary.anticipated} of those; this request covers the ${o.summary.claim} beyond them.` : 'None of these are covered by anticipated weather days in the contract.'}`,
    '',
    'Each day claimed meets two tests, both recorded independently of this letter:',
    `  1. Weather at the site (${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}) crossed the threshold shown — daily records from the Open-Meteo historical archive for that point.`,
    `  2. Equipment and crew hours logged on the site that day fell below half of a normal working day (${o.normalHours} hours, the median of the period's worked days) — from GPS records of our equipment and our crew's time clock.`,
    '',
    'Days lost:',
    ...lost.map((v) => `  ${longDay(v.day)} — ${v.reasons.join('; ')} — ${v.hours} hours worked on site`),
    '',
    `Days with bad weather that the crew worked through are listed in the attached record and are not claimed.`,
    '',
    'Please confirm the extension in writing. The full day-by-day record is attached.',
    '',
    'Sincerely,',
    '',
    o.companyName,
  ]
  return lines.join('\n')
}

/** The evidence table as CSV — every working day in the window, claimed or not. */
export function evidenceCsv(verdicts: DayVerdict[]): string {
  const rows = ['Date,Weekday,Rain (in),Max gust (mph),Low (F),High (F),Hours on site,Weather,Claimed']
  for (const v of verdicts) {
    const w = v.wx
    rows.push([v.day, v.weekday, w?.precipIn ?? '', w?.gustMph ?? '', w?.tMinF ?? '', w?.tMaxF ?? '', v.hours, `"${v.reasons.join('; ').replace(/"/g, '""')}"`, v.lost ? 'yes' : v.workedThrough ? 'worked through' : ''].join(','))
  }
  return rows.join('\n') + '\n'
}
