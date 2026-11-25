/**
 * Supplier invoices (migration 165) — reads through the caller's own RLS:
 * the table reads only for a login with the costs ability, so anyone else
 * simply gets nothing back. Demo mode returns a small fictional list.
 */
import { cleanDraft, invoiceRef, type InvoiceLine } from '@/lib/pricing/invoice'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface InvoiceRow {
  id: string
  vendorName: string
  invoiceNo: string | null
  invoiceOn: string | null
  dueOn: string | null
  freight: number | null
  fuel: number | null
  tax: number | null
  total: number | null
  lines: InvoiceLine[]
  placeId: string | null
  zoneId: string | null
  status: 'review' | 'filed'
  fileName: string | null
  hasFile: boolean
  readBy: 'ai' | 'typed' | null
  paidOn: string | null
  paidAmount: number | null
  note: string | null
  createdAt: string
  /** Its charges are on the site's job cost (a job_costs row carries its reference). */
  charged: boolean
}

/** A site an invoice can be for — `hasJob` = filing can charge its job's cost. */
export interface InvoiceSite { id: string; name: string; hasJob: boolean }

export const INVOICE_SELECT = 'id, vendor_name, invoice_no, invoice_on, due_on, freight, fuel, tax, total, lines, place_id, geofence_id, status, file_name, file_path, read_by, paid_on, paid_amount, note, created_at'
export const MAX_INVOICES = 500

const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export function invoiceFromRow(r: Record<string, unknown>, charged = false): InvoiceRow {
  const lines = cleanDraft({ lines: r.lines }).lines
  return {
    id: String(r.id), vendorName: String(r.vendor_name ?? ''), invoiceNo: (r.invoice_no as string | null) ?? null,
    invoiceOn: (r.invoice_on as string | null) ?? null, dueOn: (r.due_on as string | null) ?? null,
    freight: numOrNull(r.freight), fuel: numOrNull(r.fuel), tax: numOrNull(r.tax), total: numOrNull(r.total),
    lines, placeId: (r.place_id as string | null) ?? null, zoneId: (r.geofence_id as string | null) ?? null,
    status: r.status === 'filed' ? 'filed' : 'review', fileName: (r.file_name as string | null) ?? null, hasFile: !!r.file_path,
    readBy: r.read_by === 'ai' ? 'ai' : r.read_by === 'typed' ? 'typed' : null,
    paidOn: (r.paid_on as string | null) ?? null, paidAmount: numOrNull(r.paid_amount), note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at ?? ''), charged,
  }
}

async function db() {
  const { createClient } = await import('@/lib/supabase-server')
  return createClient()
}

/** Which invoices already sit on a job's cost (by vendor + reference). Best effort: unreadable = none. */
async function chargedSet(rows: Record<string, unknown>[]): Promise<Set<string>> {
  const out = new Set<string>()
  const refs = Array.from(new Set(rows.filter((r) => r.geofence_id).map((r) => invoiceRef(String(r.id), (r.invoice_no as string | null) ?? null))))
  if (!refs.length) return out
  try {
    const sb = await db()
    const have = new Set<string>()
    for (let i = 0; i < refs.length; i += 200) {
      const { data } = await sb.from('job_costs').select('vendor, reference').in('reference', refs.slice(i, i + 200)).is('deleted_at', null).limit(5000)
      for (const c of data ?? []) have.add(`${String(c.vendor ?? '').toLowerCase()}|${String(c.reference ?? '').toLowerCase()}`)
    }
    for (const r of rows) {
      const k = `${String(r.vendor_name ?? '').toLowerCase()}|${invoiceRef(String(r.id), (r.invoice_no as string | null) ?? null).toLowerCase()}`
      if (have.has(k)) out.add(String(r.id))
    }
  } catch { /* job_costs unreadable for this login — nothing reads as charged */ }
  return out
}

/** The company's invoices, newest first (≤ 500). `available` = the table answered. */
export async function getInvoices(): Promise<{ available: boolean; invoices: InvoiceRow[] }> {
  if (isMock) return { available: true, invoices: demoInvoices() }
  try {
    const sb = await db()
    const { data, error } = await sb.from('supplier_invoices').select(INVOICE_SELECT)
      .order('invoice_on', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(MAX_INVOICES)
    if (error) return { available: false, invoices: [] }
    const rows = (data ?? []) as Record<string, unknown>[]
    const charged = await chargedSet(rows)
    return { available: true, invoices: rows.map((r) => invoiceFromRow(r, charged.has(String(r.id)))) }
  } catch {
    return { available: false, invoices: [] }
  }
}

/** One invoice by id (null when it isn't the caller's to read). */
export async function getInvoice(id: string): Promise<InvoiceRow | null> {
  if (isMock) return demoInvoices().find((i) => i.id === id) ?? null
  if (!UUID.test(id)) return null
  try {
    const { data } = await (await db()).from('supplier_invoices').select(INVOICE_SELECT).eq('id', id).maybeSingle()
    if (!data) return null
    const row = data as Record<string, unknown>
    const charged = await chargedSet([row])
    return invoiceFromRow(row, charged.has(String(row.id)))
  } catch {
    return null
  }
}

/** The company's sites an invoice can be for (open site zones), and which have a job. */
export async function getInvoiceSites(): Promise<InvoiceSite[]> {
  if (isMock) return DEMO_SITES
  try {
    const sb = await db()
    const [{ data: gs }, { data: js }] = await Promise.all([
      sb.from('geofences').select('id, name, kind, owner_id, completed_at').is('owner_id', null).limit(2000),
      sb.from('jobs').select('geofence_id').limit(2000),
    ])
    const withJob = new Set((js ?? []).map((j) => String(j.geofence_id)))
    return (gs ?? [])
      .filter((g) => g.kind !== 'boundary' && g.kind !== 'vendor' && g.kind !== 'yard' && (!g.completed_at || withJob.has(String(g.id))))
      .map((g) => ({ id: String(g.id), name: String(g.name), hasJob: withJob.has(String(g.id)) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en-US', { numeric: true }))
  } catch {
    return []
  }
}

// ── Demo (fiction — the demo is a public surface) ───────────────────────────

const DEMO_SITES: InvoiceSite[] = [
  { id: '00000000-0000-4000-9000-000000000101', name: 'Riverfront Tower', hasJob: true },
  { id: '00000000-0000-4000-9000-000000000102', name: 'Maple St Grading', hasJob: false },
]

function demoInvoices(): InvoiceRow[] {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
  const base = { placeId: null, status: 'filed' as const, hasFile: false, readBy: 'ai' as const, note: null, fileName: null }
  const l = (description: string, qty: number, unit: InvoiceLine['unit'], unitPrice: number, ticket: string | null = null): InvoiceLine =>
    ({ description, materialId: null, qty, unit, unitPrice, amount: Math.round(qty * unitPrice * 100) / 100, ticket })
  const sum = (ls: InvoiceLine[]) => Math.round(ls.reduce((t, x) => t + (x.amount ?? 0), 0) * 100) / 100
  const a = [l('#57 STONE', 22.41, 'TON', 26.5, '304118'), l('#57 STONE', 23.06, 'TON', 26.5, '304131'), l('ABC / CRUSHER RUN', 118.7, 'TON', 22.75, null)]
  const b = [l('S9.5B SURFACE', 96.3, 'TON', 78.0, null), l('TACK COAT', 140, 'EA', 1.15, null)]
  const c = [l('SURGE STONE', 44.2, 'TON', 31.0, '88120'), l('RIP RAP CLASS B', 18.9, 'TON', 38.5, '88124')]
  const d = [l('3000 PSI READY MIX', 24, 'CY', 158.0, null)]
  const mk = (id: string, vendorName: string, invoiceNo: string, ago: number, terms: number, lines: InvoiceLine[], freight: number, fuel: number, zoneId: string | null, paid: boolean): InvoiceRow => {
    const total = Math.round((sum(lines) + freight + fuel) * 100) / 100
    return {
      ...base, id, vendorName, invoiceNo, invoiceOn: day(ago), dueOn: day(ago - terms), freight: freight || null, fuel: fuel || null, tax: null, total, lines, zoneId,
      paidOn: paid ? day(Math.max(0, ago - terms + 3)) : null, paidAmount: paid ? total : null, createdAt: new Date(Date.now() - ago * 86_400_000).toISOString(),
      charged: !!zoneId && zoneId === DEMO_SITES[0].id,
    }
  }
  return [
    mk('00000000-0000-4000-9000-000000000201', 'Piedmont Aggregates — Plant 3', 'PA-55120', 6, 30, a, 386.4, 48.3, DEMO_SITES[0].id, false),
    mk('00000000-0000-4000-9000-000000000202', 'Blue Ridge Asphalt', 'BRA-20931', 18, 30, b, 0, 112.68, DEMO_SITES[0].id, false),
    mk('00000000-0000-4000-9000-000000000203', 'Piedmont Aggregates — Plant 3', 'PA-54877', 70, 30, c, 290, 0, DEMO_SITES[1].id, false),
    mk('00000000-0000-4000-9000-000000000204', 'Palmetto Ready Mix', 'PRM-7710', 45, 15, d, 0, 0, DEMO_SITES[0].id, true),
  ]
}
