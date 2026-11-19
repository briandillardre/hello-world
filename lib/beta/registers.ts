/**
 * The Beta section's record kinds (migration 162) — pure. One schema per
 * kind: its fields, which of site / machine / person it hangs on, how its
 * title and due date are made. `cleanRecord` is the ONE validation: the
 * action runs it before every write and the form runs it before it sends, so
 * a client that skips the form can't store a row the form would refuse.
 *
 * Safe to import from client components.
 */

export type BetaKind = 'locate' | 'rental' | 'credential' | 'lien' | 'owning' | 'haul_ticket' | 'wage_rate' | 'worker_class' | 'dvir'
export const BETA_KINDS: BetaKind[] = ['locate', 'rental', 'credential', 'lien', 'owning', 'haul_ticket', 'wage_rate', 'worker_class', 'dvir']
/** Rows that carry dollars — the SQL CHECK says the same (keep in step). */
export const COSTS_ONLY_KINDS: BetaKind[] = ['rental', 'owning', 'worker_class']

export type FieldType = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'bool'
export interface Field {
  key: string
  label: string
  type: FieldType
  required?: boolean
  hint?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
  /** Max characters for text. */
  len?: number
  /** Only shown / stored when the viewer sees dollars. */
  money?: boolean
}

export type Link = 'site' | 'asset' | 'person'
export interface KindDef {
  kind: BetaKind
  noun: string
  /** Which of site / machine / person the record hangs on, and whether it must. */
  links: Partial<Record<Link, 'required' | 'optional'>>
  fields: Field[]
  /** The title shown in lists (≤ 160 chars). */
  title: (d: Record<string, unknown>, names: { site?: string | null; asset?: string | null; person?: string | null }) => string
  /** The date the record is due / runs out — drives the reminders. */
  due?: (d: Record<string, unknown>) => string | null
}

export const CREDENTIAL_KINDS: { value: string; label: string; renewsYears?: number }[] = [
  { value: 'cdl', label: 'CDL' },
  { value: 'dot_medical', label: 'DOT medical card', renewsYears: 2 },
  { value: 'osha10', label: 'OSHA 10' },
  { value: 'osha30', label: 'OSHA 30' },
  { value: 'flagger', label: 'Flagger', renewsYears: 4 },
  { value: 'competent_trench', label: 'Competent person — excavation' },
  { value: 'competent_scaffold', label: 'Competent person — scaffold' },
  { value: 'first_aid', label: 'First aid / CPR', renewsYears: 2 },
  { value: 'forklift', label: 'Forklift / telehandler', renewsYears: 3 },
  { value: 'crane', label: 'Crane operator (NCCCO)', renewsYears: 5 },
  { value: 'rigger', label: 'Rigger / signal person' },
  { value: 'msha', label: 'MSHA Part 46/48', renewsYears: 1 },
  { value: 'twic', label: 'TWIC card', renewsYears: 5 },
  { value: 'hazwoper', label: 'HAZWOPER', renewsYears: 1 },
  { value: 'other', label: 'Other' },
]

export const MATERIALS: { value: string; label: string; tonsPerCy: number }[] = [
  // loose, as hauled — typical; the ticket's own weight always wins
  { value: 'abc', label: 'ABC stone / crusher run', tonsPerCy: 1.4 },
  { value: '57', label: '#57 stone', tonsPerCy: 1.35 },
  { value: 'rip_rap', label: 'Rip rap', tonsPerCy: 1.3 },
  { value: 'sand', label: 'Sand', tonsPerCy: 1.35 },
  { value: 'fill', label: 'Fill dirt', tonsPerCy: 1.2 },
  { value: 'topsoil', label: 'Topsoil', tonsPerCy: 1.0 },
  { value: 'asphalt', label: 'Asphalt', tonsPerCy: 1.95 },
  { value: 'rap', label: 'Millings / RAP', tonsPerCy: 1.3 },
  { value: 'concrete_waste', label: 'Broken concrete', tonsPerCy: 1.2 },
  { value: 'debris', label: 'C&D debris', tonsPerCy: 0.5 },
  { value: 'other', label: 'Other', tonsPerCy: 1.3 },
]

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const optLabel = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? str(v)

export const KINDS: Record<BetaKind, KindDef> = {
  locate: {
    kind: 'locate', noun: '811 ticket',
    links: { site: 'required' },
    fields: [
      { key: 'ticket', label: 'Ticket number', type: 'text', required: true, len: 40 },
      { key: 'called', label: 'Called in', type: 'date', required: true },
      { key: 'workBegins', label: 'Work may begin', type: 'date', hint: 'SC: 3 full working days after the call' },
      { key: 'validThrough', label: 'Valid through', type: 'date', required: true, hint: 'SC tickets run 15 working days — re-call before this' },
      { key: 'kind', label: 'Ticket type', type: 'select', options: [
        { value: 'normal', label: 'Normal' }, { value: 'design', label: 'Design' }, { value: 'emergency', label: 'Emergency' },
        { value: 'remark', label: 'Re-mark' }, { value: 'update', label: 'Update / re-call' }] },
      { key: 'where', label: 'Where on the site', type: 'text', len: 200, hint: 'Street, station, or "whole site"' },
      { key: 'utilities', label: 'Utilities notified', type: 'text', len: 300 },
      { key: 'notes', label: 'Notes', type: 'textarea', len: 2000 },
    ],
    title: (d, n) => `#${str(d.ticket)} · ${n.site ?? 'site'}`,
    due: (d) => (isDay(d.validThrough) ? String(d.validThrough) : null),
  },
  rental: {
    kind: 'rental', noun: 'rental',
    links: { site: 'optional', asset: 'optional' },
    fields: [
      { key: 'what', label: 'What', type: 'text', required: true, len: 120, hint: 'e.g. CAT 320 excavator' },
      { key: 'vendor', label: 'Rental company', type: 'text', required: true, len: 120 },
      { key: 'contract', label: 'Contract / PO', type: 'text', len: 60 },
      { key: 'onRent', label: 'On rent', type: 'date', required: true },
      { key: 'expectedOff', label: 'Expected off rent', type: 'date' },
      { key: 'offRentCalled', label: 'Off-rent called', type: 'date', hint: 'The day you called it in — billing stops here' },
      { key: 'callOffNo', label: 'Call-off number', type: 'text', len: 40 },
      { key: 'dayRate', label: 'Day rate', type: 'money', money: true, min: 0, max: 100000 },
      { key: 'weekRate', label: 'Week rate', type: 'money', money: true, min: 0, max: 100000 },
      { key: 'monthRate', label: '4-week rate', type: 'money', money: true, min: 0, max: 500000 },
      { key: 'delivery', label: 'Delivery + pickup', type: 'money', money: true, min: 0, max: 100000 },
      { key: 'notes', label: 'Notes', type: 'textarea', len: 2000 },
    ],
    title: (d) => `${str(d.what)} · ${str(d.vendor)}`,
    due: (d) => (isDay(d.offRentCalled) ? null : isDay(d.expectedOff) ? String(d.expectedOff) : null),
  },
  credential: {
    kind: 'credential', noun: 'card or cert',
    links: { person: 'required' },
    fields: [
      { key: 'type', label: 'Card / cert', type: 'select', required: true, options: CREDENTIAL_KINDS.map(({ value, label }) => ({ value, label })) },
      { key: 'other', label: 'Name it', type: 'text', len: 80, hint: 'Only for "Other"' },
      { key: 'number', label: 'Number (last 6)', type: 'text', len: 40, hint: 'Only the last six letters/digits are kept — never the whole number' },
      { key: 'issued', label: 'Issued', type: 'date' },
      { key: 'expires', label: 'Expires', type: 'date', hint: 'Blank = does not expire' },
      { key: 'issuer', label: 'Issued by', type: 'text', len: 80 },
    ],
    title: (d, n) => `${d.type === 'other' && str(d.other) ? str(d.other) : optLabel(CREDENTIAL_KINDS, d.type)} · ${n.person ?? 'crew'}`,
    due: (d) => (isDay(d.expires) ? String(d.expires) : null),
  },
  lien: {
    kind: 'lien', noun: 'lien sheet',
    links: { site: 'required' },
    fields: [
      { key: 'role', label: 'We are the', type: 'select', required: true, options: [
        { value: 'prime', label: 'Prime (contract with the owner)' }, { value: 'sub', label: 'Subcontractor' },
        { value: 'sub2', label: 'Sub-subcontractor' }, { value: 'supplier', label: 'Supplier' }] },
      { key: 'public', label: 'Public job (bond, no lien on public land)', type: 'bool' },
      { key: 'nocFiled', label: 'Owner filed a Notice of Project Commencement', type: 'bool' },
      { key: 'firstFurnished', label: 'First furnished (override)', type: 'date', hint: 'Blank = the first day our machines or crew were on the site' },
      { key: 'lastFurnished', label: 'Last furnished (override)', type: 'date', hint: 'Blank = the last day on site; set it when the work is done' },
      { key: 'nofServed', label: 'Notice of furnishing served', type: 'date' },
      { key: 'lienFiled', label: 'Lien filed', type: 'date' },
      { key: 'released', label: 'Paid / released', type: 'date', hint: 'Set when you are paid in full — the clock stops' },
      { key: 'notes', label: 'Notes', type: 'textarea', len: 2000 },
    ],
    title: (_d, n) => n.site ?? 'Job',
  },
  owning: {
    kind: 'owning', noun: 'ownership sheet',
    links: { asset: 'required' },
    fields: [
      { key: 'price', label: 'Delivered price', type: 'money', money: true, required: true, min: 0, max: 20_000_000 },
      { key: 'salvage', label: 'Salvage at the end', type: 'money', money: true, min: 0, max: 20_000_000 },
      { key: 'lifeYears', label: 'Life (years)', type: 'number', min: 1, max: 40, required: true },
      { key: 'plannedHours', label: 'Planned hours a year', type: 'number', min: 50, max: 8760, hint: 'Blank = what the hours ledger measured' },
      { key: 'interestPct', label: 'Interest / cost of money %', type: 'number', min: 0, max: 30 },
      { key: 'insuranceYr', label: 'Insurance a year', type: 'money', money: true, min: 0, max: 1_000_000 },
      { key: 'taxStorageYr', label: 'Tax, license, storage a year', type: 'money', money: true, min: 0, max: 1_000_000 },
      { key: 'fuelGph', label: 'Fuel gal / hr', type: 'number', min: 0, max: 100 },
      { key: 'fuelPrice', label: 'Fuel $ / gal', type: 'money', money: true, min: 0, max: 20 },
      { key: 'repairPct', label: 'Lifetime repairs as % of price', type: 'number', min: 0, max: 300, hint: 'Typical: 50–90% for dirt machines' },
      { key: 'wearHr', label: 'Tires / tracks / wear parts $ / hr', type: 'money', money: true, min: 0, max: 500 },
      { key: 'rentRate', label: 'What it rents for ($ / 4 weeks)', type: 'money', money: true, min: 0, max: 500_000, hint: 'For rent-vs-own' },
      { key: 'currentValue', label: 'What it would sell for today', type: 'money', money: true, min: 0, max: 20_000_000, hint: 'For replace-now' },
    ],
    title: (_d, n) => n.asset ?? 'Machine',
  },
  haul_ticket: {
    kind: 'haul_ticket', noun: 'haul ticket',
    links: { site: 'required', asset: 'optional' },
    fields: [
      { key: 'ticket', label: 'Ticket number', type: 'text', required: true, len: 40 },
      { key: 'day', label: 'Day', type: 'date', required: true },
      { key: 'time', label: 'Time on ticket', type: 'text', len: 8, hint: 'e.g. 7:42' },
      { key: 'source', label: 'From (quarry / plant / dump)', type: 'text', len: 120, required: true },
      { key: 'direction', label: 'Direction', type: 'select', required: true, options: [{ value: 'in', label: 'Hauled in (import)' }, { value: 'out', label: 'Hauled out (export / dump)' }] },
      { key: 'material', label: 'Material', type: 'select', required: true, options: MATERIALS.map(({ value, label }) => ({ value, label })) },
      { key: 'tons', label: 'Net tons', type: 'number', min: 0, max: 60 },
      { key: 'cy', label: 'Cubic yards', type: 'number', min: 0, max: 60, hint: 'Blank = worked out from the tons' },
      { key: 'truckText', label: 'Truck (if not ours)', type: 'text', len: 60, hint: 'Hauler name / truck number' },
      // no price here: a ticket row is readable by every foreman (not costs-only) — prices live in the cost book
    ],
    title: (d, n) => `#${str(d.ticket)} · ${n.asset ?? (str(d.truckText) || 'truck')}`,
  },
  wage_rate: {
    kind: 'wage_rate', noun: 'wage line',
    links: { site: 'required' },
    fields: [
      { key: 'classification', label: 'Classification', type: 'text', required: true, len: 80, hint: 'As written on the wage decision, e.g. "Operator: Excavator"' },
      { key: 'base', label: 'Base rate $/hr', type: 'money', required: true, min: 0, max: 500 },
      { key: 'fringe', label: 'Fringe $/hr', type: 'money', min: 0, max: 500 },
      { key: 'decision', label: 'Wage decision', type: 'text', len: 40, hint: 'e.g. SC20260012 Mod 3' },
    ],
    title: (d, n) => `${str(d.classification)} · ${n.site ?? 'job'}`,
  },
  worker_class: {
    kind: 'worker_class', noun: 'payroll class',
    links: { person: 'required' },
    fields: [
      { key: 'classification', label: 'Classification', type: 'text', required: true, len: 80, hint: 'Must match the wage decision wording' },
      { key: 'idLast4', label: 'ID / SSN last 4', type: 'text', len: 4, hint: 'Last four only — never the whole number' },
      { key: 'base', label: 'Base rate paid $/hr', type: 'money', money: true, required: true, min: 0, max: 500 },
      { key: 'fringeCash', label: 'Fringe paid in cash $/hr', type: 'money', money: true, min: 0, max: 500 },
      { key: 'fringePlan', label: 'Fringe paid to plans $/hr', type: 'money', money: true, min: 0, max: 500 },
      { key: 'apprentice', label: 'Registered apprentice', type: 'bool' },
    ],
    title: (d, n) => `${n.person ?? 'Crew'} · ${str(d.classification)}`,
  },
  dvir: {
    kind: 'dvir', noun: 'inspection',
    links: { asset: 'required' },
    fields: [], // the DVIR form is its own screen (lib/beta/dvir.ts)
    title: (d, n) => `${d.when === 'post' ? 'Post-trip' : 'Pre-trip'} · ${n.asset ?? 'vehicle'}`,
  },
}

export function isDay(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
}

export interface Cleaned { data: Record<string, unknown>; title: string; dueOn: string | null }

/**
 * Validate a form's fields for a kind. Unknown keys are dropped; text is
 * trimmed and capped; numbers are bounded; dates are YYYY-MM-DD. Money fields
 * are dropped unless `withMoney` (the server passes the caller's costs
 * ability, so a login without it can never write a rate).
 */
export function cleanRecord(kind: BetaKind, raw: unknown, names: { site?: string | null; asset?: string | null; person?: string | null }, withMoney: boolean): { ok: true; value: Cleaned } | { ok: false; error: string } {
  const def = KINDS[kind]
  if (!def) return { ok: false, error: 'Unknown record.' }
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const data: Record<string, unknown> = {}
  for (const f of def.fields) {
    if (f.money && !withMoney) continue
    if (!Object.prototype.hasOwnProperty.call(src, f.key)) { if (f.required) return { ok: false, error: `${f.label} is needed.` }; continue }
    const v = src[f.key]
    const blank = v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
    if (blank) { if (f.required) return { ok: false, error: `${f.label} is needed.` }; continue }
    switch (f.type) {
      case 'text': case 'textarea': {
        if (typeof v !== 'string') return { ok: false, error: `${f.label} should be words.` }
        data[f.key] = v.trim().slice(0, f.len ?? 200)
        break
      }
      case 'number': case 'money': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
        if (!Number.isFinite(n)) return { ok: false, error: `${f.label} should be a number.` }
        if (f.min !== undefined && n < f.min) return { ok: false, error: `${f.label} can't be under ${f.min}.` }
        if (f.max !== undefined && n > f.max) return { ok: false, error: `${f.label} can't be over ${f.max.toLocaleString('en-US')}.` }
        data[f.key] = Math.round(n * 100) / 100
        break
      }
      case 'date': {
        if (!isDay(v)) return { ok: false, error: `${f.label} should be a date.` }
        data[f.key] = v
        break
      }
      case 'select': {
        if (!f.options?.some((o) => o.value === v)) return { ok: false, error: `Pick a ${f.label.toLowerCase()}.` }
        data[f.key] = v
        break
      }
      case 'bool':
        data[f.key] = v === true || v === 'true' || v === 'on'
        break
    }
  }
  // cross-field rules
  if (kind === 'locate' && isDay(data.called) && isDay(data.validThrough) && String(data.validThrough) < String(data.called)) return { ok: false, error: 'Valid through is before the call.' }
  if (kind === 'rental' && isDay(data.onRent) && isDay(data.offRentCalled) && String(data.offRentCalled) < String(data.onRent)) return { ok: false, error: 'Off rent is before on rent.' }
  if (kind === 'owning' && typeof data.salvage === 'number' && typeof data.price === 'number' && data.salvage > data.price) return { ok: false, error: 'Salvage is more than the price.' }
  if (kind === 'worker_class' && data.idLast4 !== undefined && !/^\d{4}$/.test(String(src.idLast4).trim())) return { ok: false, error: 'ID: the last four digits only.' }
  if (kind === 'credential' && data.type === 'other' && !data.other) return { ok: false, error: 'Name the card.' }
  // a card number is an identifier (a CDL number IS the licence): keep the last six letters/digits only
  if (kind === 'credential' && typeof data.number === 'string') {
    const tail = data.number.replace(/[^A-Za-z0-9]/g, '').slice(-6)
    if (tail) data.number = tail
    else delete data.number
  }
  if (kind === 'haul_ticket' && data.tons === undefined && data.cy === undefined) return { ok: false, error: 'Tons or cubic yards — one of them.' }
  const title = def.title(data, names).replace(/\s+/g, ' ').trim().slice(0, 160) || def.noun
  return { ok: true, value: { data, title, dueOn: def.due?.(data) ?? null } }
}

/** A record's fields with the dollar ones removed — for a login without costs. */
export function withoutMoney(kind: BetaKind, data: Record<string, unknown>): Record<string, unknown> {
  const money = new Set(KINDS[kind].fields.filter((f) => f.money).map((f) => f.key))
  return Object.fromEntries(Object.entries(data).filter(([k]) => !money.has(k)))
}

/** Days from `today` to `due` (negative = past). Both YYYY-MM-DD. */
export function daysUntil(today: string, due: string): number {
  return Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
}

export type DueState = 'overdue' | 'soon' | 'ok' | null
export function dueState(due: string | null, today: string, soonDays = 30): DueState {
  if (!due || !isDay(due)) return null
  const d = daysUntil(today, due)
  return d < 0 ? 'overdue' : d <= soonDays ? 'soon' : 'ok'
}

export function dueWords(due: string, today: string, verb = 'Due'): string {
  const d = daysUntil(today, due)
  if (d < 0) return `${verb === 'Due' ? 'Overdue' : 'Ran out'} ${-d} ${-d === 1 ? 'day' : 'days'}`
  if (d === 0) return `${verb} today`
  return `${verb} in ${d} ${d === 1 ? 'day' : 'days'}`
}

/** Add n calendar days to a YYYY-MM-DD. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Add n calendar MONTHS, clamped to the month's last day (Aug 31 + 6 months = Feb 28) — legal deadlines run by the calendar, never by 30-day months. */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

/** Add n WORKING days (Mon–Fri; holidays are not modelled — said on the page). */
export function addWorkdays(day: string, n: number): string {
  let t = Date.parse(`${day}T12:00:00Z`)
  let left = n
  while (left > 0) {
    t += 86_400_000
    const w = new Date(t).getUTCDay()
    if (w !== 0 && w !== 6) left--
  }
  return new Date(t).toISOString().slice(0, 10)
}
