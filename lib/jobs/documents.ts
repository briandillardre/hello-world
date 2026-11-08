/**
 * The job's documents (migration 156) — pure. Every paper a job collects,
 * filed by type: the contract, insurance certificates, permits, submittals,
 * RFIs, inspections, lien waivers, warranties, as-builts. The money papers
 * (contract, signed change orders, lien waivers, invoices, the W-9 with the
 * company's tax number, bonds) are for logins that see costs — the database
 * holds that rule too (`costs_only`, CHECKed against the type). Insurance,
 * permits and bonds carry an expiry date the job page warns about. Plans
 * stay in the plan room, photos on the site. Shared by the documents page,
 * the job page and `scripts/closeout-test.mjs`.
 */

export const DOC_KINDS = [
  'contract', 'change_order', 'lien_waiver', 'invoice', 'w9', 'bond',
  'insurance', 'permit', 'submittal', 'rfi', 'inspection', 'warranty', 'asbuilt', 'correspondence', 'safety', 'other',
] as const
export type DocKind = (typeof DOC_KINDS)[number]
export const isDocKind = (v: unknown): v is DocKind => typeof v === 'string' && (DOC_KINDS as readonly string[]).includes(v)

export const DOC_KIND_WORDS: Record<DocKind, string> = {
  contract: 'Contract & proposal', change_order: 'Signed change orders', lien_waiver: 'Lien waivers', invoice: 'Invoices & pay app backup',
  w9: 'W-9 & tax forms', bond: 'Bonds', insurance: 'Insurance certificates (COIs)', permit: 'Permits & approvals',
  submittal: 'Submittals & shop drawings', rfi: 'RFIs', inspection: 'Inspections & tests', warranty: 'Warranties & O&M',
  asbuilt: 'As-builts & surveys', correspondence: 'Letters & notices', safety: 'Safety', other: 'Other',
}

/** The papers with dollars (or the tax number) on them — costs only. Keep in step with 156's CHECK. */
export const COSTS_ONLY_KINDS: readonly DocKind[] = ['contract', 'change_order', 'lien_waiver', 'invoice', 'w9', 'bond']
export const costsOnly = (k: DocKind): boolean => COSTS_ONLY_KINDS.includes(k)

/** Papers that run out. */
export const EXPIRING_KINDS: readonly DocKind[] = ['insurance', 'permit', 'bond']
/** One paper of a kind that runs out, in words ("Permit: Land disturbance — Expires in 12 days"). */
export const ONE_WORDS: Partial<Record<DocKind, string>> = { insurance: 'Insurance certificate', permit: 'Permit', bond: 'Bond' }
export const SOON_DAYS = 30

export interface JobDocument {
  id: string
  kind: DocKind
  title: string
  docDate: string | null
  expiresOn: string | null
  note: string | null
  filename: string
  sizeBytes: number
  payAppId: string | null
  createdBy: string | null
  createdAt: string
}

export const MAX_DOC_BYTES = 50 * 1024 * 1024

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const clip = (v: unknown, n: number): string | null => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) || null : null)
const day = (v: unknown): string | null => {
  if (typeof v !== 'string' || !DAY.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= '1990-01-01' && v <= '2100-12-31' ? v : null
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** expired · soon (within 30 days) · ok — null when the paper doesn't run out. */
export function expiryState(expiresOn: string | null, today: string): 'expired' | 'soon' | 'ok' | null {
  if (!expiresOn || !day(expiresOn)) return null
  const d = daysBetween(today, expiresOn)
  return d < 0 ? 'expired' : d <= SOON_DAYS ? 'soon' : 'ok'
}

/** "Expired 3 days ago" / "Expires today" / "Expires in 12 days". */
export function expiryWords(expiresOn: string, today: string): string {
  const d = daysBetween(today, expiresOn)
  if (d < 0) return `Expired ${-d} ${-d === 1 ? 'day' : 'days'} ago`
  if (d === 0) return 'Expires today'
  return `Expires in ${d} ${d === 1 ? 'day' : 'days'}`
}

/** The papers that have run out or will within 30 days, soonest first. */
export function expiring<T extends Pick<JobDocument, 'expiresOn'>>(docs: T[], today: string): T[] {
  return docs.filter((d) => { const s = expiryState(d.expiresOn, today); return s === 'expired' || s === 'soon' })
    .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''))
}

/** A first guess at the type from the file's name — the person filing it can change it. */
export function kindFromName(filename: string): DocKind {
  const s = filename.toLowerCase().replace(/[_.-]+/g, ' ')
  if (/\bcoi\b|certificate of (liability )?insurance|insurance/.test(s)) return 'insurance'
  if (/\bw ?9\b/.test(s)) return 'w9'
  if (/lien|waiver|release of lien/.test(s)) return 'lien_waiver'
  if (/\bbond\b/.test(s)) return 'bond'
  if (/permit|approval|encroachment|ncdot|scdot|dhec|npdes|land disturbance/.test(s)) return 'permit'
  if (/change order|\bco ?\d+\b|\bpco\b/.test(s)) return 'change_order'
  if (/invoice|pay ?app|\bg70[23]\b|application for payment/.test(s)) return 'invoice'
  if (/contract|subcontract|agreement|proposal|\bloi\b|letter of intent|notice to proceed|\bntp\b/.test(s)) return 'contract'
  if (/submittal|shop ?draw|cut ?sheet|product data/.test(s)) return 'submittal'
  if (/\brfi\b|request for information/.test(s)) return 'rfi'
  if (/inspect|density|compaction|proctor|\btest\b|testing|geotech/.test(s)) return 'inspection'
  if (/warrant|o ?& ?m|o and m|operation|maintenance manual/.test(s)) return 'warranty'
  if (/as ?built|record drawing|survey|redline/.test(s)) return 'asbuilt'
  if (/safety|jha|jsa|toolbox|osha|incident/.test(s)) return 'safety'
  if (/letter|notice|memo|email|correspond/.test(s)) return 'correspondence'
  return 'other'
}

export interface DocMeta { kind: DocKind; title: string; docDate: string | null; expiresOn: string | null; note: string | null; payAppId: string | null }

/**
 * A document's words from a form. A money paper needs the costs ability;
 * only papers that run out keep an expiry; only a lien waiver or an invoice
 * points at a pay application.
 */
export function cleanDocMeta(raw: unknown, opts: { money: boolean; filename?: string }): { meta: DocMeta | null; error?: string } {
  if (!raw || typeof raw !== 'object') return { meta: null, error: 'Nothing to save.' }
  const o = raw as Record<string, unknown>
  const kind: DocKind = isDocKind(o.kind) ? o.kind : kindFromName(opts.filename ?? '')
  if (costsOnly(kind) && !opts.money) return { meta: null, error: `${DOC_KIND_WORDS[kind]} are for logins that can see costs.` }
  const title = clip(o.title, 200) ?? clip((opts.filename ?? '').replace(/\.[a-z0-9]{1,6}$/i, ''), 200)
  if (!title) return { meta: null, error: 'Give it a title.' }
  if (o.docDate && !day(o.docDate)) return { meta: null, error: 'That date can’t be read.' }
  if (o.expiresOn && !day(o.expiresOn)) return { meta: null, error: 'That expiry date can’t be read.' }
  const payApp = typeof o.payAppId === 'string' && UUID.test(o.payAppId) && (kind === 'lien_waiver' || kind === 'invoice') ? o.payAppId : null
  return {
    meta: {
      kind, title,
      docDate: day(o.docDate),
      expiresOn: EXPIRING_KINDS.includes(kind) ? day(o.expiresOn) : null,
      note: clip(o.note, 500),
      payAppId: payApp,
    },
  }
}

/** "1.2 MB" / "640 KB". */
export function sizeWords(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
