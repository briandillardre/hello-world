/**
 * The daily-log form schema — client-safe (no server imports).
 *
 * The admin builds the crew's clock-out log like a form: a library of
 * standard construction-log sections (weather-of-the-day writeup, safety,
 * fuel checks, materials, inspections, delays, subs…) each toggleable and
 * markable required, plus custom questions of any type. NULL config =
 * LOG_FORM_DEFAULTS, which reproduces the pre-059 hardcoded form exactly.
 *
 * Standard items (std set) write to their legacy daily_logs columns so
 * nothing downstream (digests, safety push, receipts inbox) changes.
 * Custom answers persist self-describing as [{id, label, value}].
 */

export type LogItemType = 'text' | 'longtext' | 'number' | 'yesno' | 'choice' | 'checklist' | 'photos'

export interface LogFormItem {
  /** Stable key. Standard ids are fixed; custom ids are `c_<random>`. */
  id: string
  label: string
  type: LogItemType
  required: boolean
  enabled: boolean
  /** For choice / checklist. */
  options?: string[]
  /** Placeholder / helper text shown in the field. */
  hint?: string
  /** Maps to a legacy daily_logs column / special widget. Absent = custom. */
  std?: 'writeup' | 'safety' | 'trucks_fueled' | 'equipment_fueled' | 'photos' | 'receipts'
}

export interface LogAnswer {
  id: string
  label: string
  value: string | number | boolean | string[]
}

export const LOG_ITEM_TYPES: { key: LogItemType; label: string }[] = [
  { key: 'text', label: 'Short answer' },
  { key: 'longtext', label: 'Paragraph' },
  { key: 'number', label: 'Number' },
  { key: 'yesno', label: 'Yes / No' },
  { key: 'choice', label: 'Pick one' },
  { key: 'checklist', label: 'Check all that apply' },
  { key: 'photos', label: 'Photos' },
]

export const LOG_FORM_DEFAULTS: LogFormItem[] = [
  { id: 'writeup', std: 'writeup', type: 'longtext', enabled: true, required: true, label: 'Daily writeup', hint: "What got done today? Problems? What's queued for tomorrow?" },
  { id: 'safety', std: 'safety', type: 'longtext', enabled: true, required: false, label: 'Safety issues', hint: 'Leave blank if none — anything written here pages the owner immediately.' },
  { id: 'trucks_fueled', std: 'trucks_fueled', type: 'yesno', enabled: true, required: true, label: 'Trucks fueled?' },
  { id: 'equipment_fueled', std: 'equipment_fueled', type: 'yesno', enabled: true, required: true, label: 'Equipment fueled?' },
  { id: 'photos', std: 'photos', type: 'photos', enabled: true, required: false, label: 'Job photos' },
  { id: 'receipts', std: 'receipts', type: 'photos', enabled: true, required: false, label: 'Receipts' },
  // Standard sections a GC can flip on — off by default so existing crews
  // see zero change until the admin opts in.
  { id: 'materials', type: 'longtext', enabled: false, required: false, label: 'Materials & deliveries', hint: 'Supplier, ticket #, what came in' },
  { id: 'subs', type: 'longtext', enabled: false, required: false, label: 'Subcontractors on site', hint: 'Who, headcount, hours' },
  { id: 'visitors', type: 'longtext', enabled: false, required: false, label: 'Visitors & inspections', hint: 'Inspector, agency, result' },
  { id: 'delays', type: 'choice', enabled: false, required: false, label: 'Any delays?', options: ['None', 'Weather', 'Materials', 'Labor', 'Equipment', 'Other'] },
  { id: 'toolbox', type: 'text', enabled: false, required: false, label: 'Toolbox talk topic' },
]

const TYPES = new Set<LogItemType>(['text', 'longtext', 'number', 'yesno', 'choice', 'checklist', 'photos'])

/** Sanitize one stored/submitted item. Null = drop it. */
function cleanItem(raw: unknown): LogFormItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) : ''
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, 90) : ''
  const type = TYPES.has(r.type as LogItemType) ? (r.type as LogItemType) : null
  if (!id || !label || !type) return null
  const def = LOG_FORM_DEFAULTS.find((d) => d.id === id)
  const item: LogFormItem = {
    id,
    label,
    // A standard item's type and column mapping are structural, not editable.
    type: def ? def.type : type,
    required: !!r.required,
    enabled: !!r.enabled,
  }
  if (def?.std) item.std = def.std
  if ((item.type === 'choice' || item.type === 'checklist')) {
    const opts = Array.isArray(r.options)
      ? r.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim().slice(0, 48)).filter(Boolean).slice(0, 16)
      : def?.options ?? []
    if (!opts.length) return null
    item.options = opts
  }
  const hint = typeof r.hint === 'string' ? r.hint.trim().slice(0, 160) : def?.hint
  if (hint) item.hint = hint
  return item
}

/** Stored jsonb (or null / garbage / older shape) → a safe, complete form.
 *  Standard items the stored config doesn't know about yet are appended
 *  disabled, so new library sections show up in the builder after deploys. */
export function resolveLogForm(raw: unknown): LogFormItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return LOG_FORM_DEFAULTS.map((d) => ({ ...d }))
  const items = raw.map(cleanItem).filter((x): x is LogFormItem => x !== null).slice(0, 60)
  if (!items.length) return LOG_FORM_DEFAULTS.map((d) => ({ ...d }))
  const seen = new Set(items.map((i) => i.id))
  for (const d of LOG_FORM_DEFAULTS) {
    if (!seen.has(d.id)) items.push({ ...d, enabled: false })
  }
  return items
}
