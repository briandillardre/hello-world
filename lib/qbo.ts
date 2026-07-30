import type { QboInvoicePreview, AssetUtilization, QboConnection } from './types'
import { MOCK_QBO_CONNECTION, MOCK_UTILIZATION, MOCK_EQUIPMENT_RATES, MOCK_ASSETS } from './mock-data'

/**
 * QuickBooks Online integration — server-side only (tokens never reach the
 * client). Two money flows, both grounded in how real contractor books look
 * (typically an EMPTY item list — so everything here find-or-creates):
 *
 *   1. Zone → Invoice: tracked equipment/labor usage inside a job-site zone
 *      becomes a draft invoice (customer = the zone/job, one line per asset).
 *   2. Service record → Expense: a maintenance entry becomes a Purchase
 *      against a Repairs & Maintenance expense account.
 */

export const isQboConfigured = !!process.env.QBO_CLIENT_ID

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// Fallbacks only — the live endpoints come from Intuit's OAuth discovery
// document (below), which is how Intuit communicates endpoint changes.
const QBO_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_SCOPES = 'com.intuit.quickbooks.accounting'
const MINOR = 'minorversion=75'

const sandbox = process.env.QBO_ENVIRONMENT !== 'production'
export const QBO_API_BASE = sandbox
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com'
/** Deep link to a transaction in the QBO UI (for "open in QuickBooks"). */
export function qboTxnUrl(kind: 'invoice' | 'expense', id: string): string {
  const host = sandbox ? 'https://sandbox.qbo.intuit.com' : 'https://qbo.intuit.com'
  return `${host}/app/${kind}?txnId=${id}`
}

/**
 * OAuth endpoints from Intuit's DISCOVERY DOCUMENT, cached 24h.
 * https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-openid-discovery-doc
 *
 * Intuit rotates/retires endpoints via this document rather than email, so
 * reading it is the difference between surviving an endpoint migration and
 * every customer's books silently disconnecting. Any failure falls back to
 * the documented constants above — discovery being down must never take
 * OAuth down with it.
 */
interface DiscoveryDoc { authorization_endpoint?: string; token_endpoint?: string }
let discoveryCache: { doc: DiscoveryDoc; fetchedAt: number } | null = null

async function discoverEndpoints(): Promise<{ authBase: string; tokenUrl: string }> {
  const DISCOVERY_URL = sandbox
    ? 'https://developer.api.intuit.com/.well-known/openid_sandbox_configuration'
    : 'https://developer.api.intuit.com/.well-known/openid_configuration'
  const DAY = 24 * 60 * 60_000
  if (!discoveryCache || Date.now() - discoveryCache.fetchedAt > DAY) {
    try {
      const res = await fetch(DISCOVERY_URL, { signal: AbortSignal.timeout(5000) })
      if (res.ok) discoveryCache = { doc: (await res.json()) as DiscoveryDoc, fetchedAt: Date.now() }
    } catch { /* keep whatever cache exists; fall back below */ }
  }
  return {
    authBase: discoveryCache?.doc.authorization_endpoint ?? QBO_AUTH_BASE,
    tokenUrl: discoveryCache?.doc.token_endpoint ?? QBO_TOKEN_URL,
  }
}

/** Build the Intuit OAuth2 authorization URL (endpoint from discovery). */
export async function buildAuthorizeUrl(state: string): Promise<string> {
  const { authBase } = await discoverEndpoints()
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID ?? '',
    response_type: 'code',
    scope: QBO_SCOPES,
    redirect_uri: process.env.QBO_REDIRECT_URI ?? '',
    state,
  })
  return `${authBase}?${params.toString()}`
}

export interface QboTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  realmId?: string
}

async function tokenGrant(body: Record<string, string>): Promise<QboTokenResponse> {
  const basic = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')
  const { tokenUrl } = await discoverEndpoints()
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(body),
  })
  if (!res.ok) throw new Error(`QBO token grant failed: ${res.status}`)
  return res.json()
}

/** Exchange an authorization code for tokens (Intuit token endpoint). */
export function exchangeCodeForTokens(code: string): Promise<QboTokenResponse> {
  return tokenGrant({
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.QBO_REDIRECT_URI ?? '',
  })
}

// ── Connection store (Supabase, service client — server only) ────────────────

export interface LiveConnection {
  companyId: string
  realmId: string
  accessToken: string
}

/** The company's QBO connection with a fresh access token. Auto-refreshes when
 *  within 5 min of expiry and persists the ROTATED refresh token (Intuit
 *  rotates it on every refresh — dropping it bricks the connection in 24h). */
export async function getLiveConnection(companyId: string): Promise<LiveConnection | null> {
  if (!isQboConfigured || isMock) return null
  const { createServiceClient } = await import('./supabase-server')
  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from('qbo_connections')
    .select('realm_id, access_token, refresh_token, expires_at')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!row) return null

  let accessToken = row.access_token
  if (new Date(row.expires_at).getTime() - Date.now() < 5 * 60_000) {
    const t = await tokenGrant({ grant_type: 'refresh_token', refresh_token: row.refresh_token })
    accessToken = t.access_token
    await supabase.from('qbo_connections').update({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    }).eq('company_id', companyId)
  }
  return { companyId, realmId: row.realm_id, accessToken }
}

/** Connection status for the accounting page. Demo when unconfigured. */
export async function getConnectionStatus(companyId?: string): Promise<{
  connected: boolean
  demo: boolean
  connection: QboConnection | null
}> {
  if (!isQboConfigured || isMock || !companyId) {
    return { connected: true, demo: true, connection: MOCK_QBO_CONNECTION }
  }
  const { createServiceClient } = await import('./supabase-server')
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('qbo_connections')
    .select('realm_id, company_name, connected_at')
    .eq('company_id', companyId)
    .maybeSingle()
  if (!data) return { connected: false, demo: false, connection: null }
  return {
    connected: true,
    demo: false,
    connection: {
      realm_id: data.realm_id,
      company_name: data.company_name ?? 'QuickBooks company',
      connected_at: data.connected_at,
    } as QboConnection,
  }
}

// ── Low-level API helpers ─────────────────────────────────────────────────────

async function qboFetch(conn: LiveConnection, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const url = `${QBO_API_BASE}/v3/company/${conn.realmId}${path}${path.includes('?') ? '&' : '?'}${MINOR}`
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`QBO ${init?.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

function qboQuery(conn: LiveConnection, sql: string) {
  return qboFetch(conn, `/query?query=${encodeURIComponent(sql)}`)
}

// QBO query strings take single-quoted literals; escape embedded quotes.
const q = (s: string) => s.replace(/'/g, "\\'")

type Entity = { Id: string; Name?: string; DisplayName?: string }

function firstEntity(resp: Record<string, unknown>, key: string): Entity | null {
  const qr = resp.QueryResponse as Record<string, unknown> | undefined
  const list = qr?.[key] as Entity[] | undefined
  return list?.[0] ?? null
}

// ── Find-or-create primitives (contractor books are usually EMPTY) ──────────

export async function findOrCreateCustomer(conn: LiveConnection, name: string): Promise<string> {
  const found = firstEntity(
    await qboQuery(conn, `select Id from Customer where DisplayName = '${q(name)}'`), 'Customer')
  if (found) return found.Id
  const created = await qboFetch(conn, '/customer', {
    method: 'POST', body: JSON.stringify({ DisplayName: name }),
  })
  return (created.Customer as Entity).Id
}

/** Customer id by exact DisplayName, or null. Used to pair a zone with the
 *  QBO customer the crews already pick in Workforce (same name = same job). */
export async function findCustomerByName(conn: LiveConnection, name: string): Promise<string | null> {
  const found = firstEntity(
    await qboQuery(conn, `select Id from Customer where DisplayName = '${q(name)}'`), 'Customer')
  return found?.Id ?? null
}

/** Rename a QBO customer (sparse update; QBO requires the current SyncToken).
 *  This is the Z-flip on the books side: complete a job in HammerTrack and
 *  the Workforce pick list renames (and re-sorts) itself to match. */
export async function renameCustomer(conn: LiveConnection, customerId: string, newName: string): Promise<void> {
  const resp = await qboFetch(conn, `/customer/${customerId}`)
  const cust = resp.Customer as { Id: string; SyncToken: string }
  await qboFetch(conn, '/customer', {
    method: 'POST',
    body: JSON.stringify({ Id: cust.Id, SyncToken: cust.SyncToken, sparse: true, DisplayName: newName }),
  })
}

export async function findOrCreateVendor(conn: LiveConnection, name: string): Promise<string> {
  const found = firstEntity(
    await qboQuery(conn, `select Id from Vendor where DisplayName = '${q(name)}'`), 'Vendor')
  if (found) return found.Id
  const created = await qboFetch(conn, '/vendor', {
    method: 'POST', body: JSON.stringify({ DisplayName: name }),
  })
  return (created.Vendor as Entity).Id
}

async function firstAccount(conn: LiveConnection, type: string, nameLike?: string): Promise<Entity | null> {
  if (nameLike) {
    const hit = firstEntity(await qboQuery(conn,
      `select Id, Name from Account where AccountType = '${q(type)}' and Name like '%${q(nameLike)}%'`), 'Account')
    if (hit) return hit
  }
  return firstEntity(await qboQuery(conn,
    `select Id, Name from Account where AccountType = '${q(type)}'`), 'Account')
}

/** Service item to bill usage under. Creates "HammerTrack Usage" (Service,
 *  non-taxable) wired to the books' first Income account if none exists. */
export async function findOrCreateServiceItem(conn: LiveConnection, name = 'HammerTrack Usage'): Promise<string> {
  const found = firstEntity(
    await qboQuery(conn, `select Id from Item where Name = '${q(name)}'`), 'Item')
  if (found) return found.Id
  let income = await firstAccount(conn, 'Income', 'Service')
  if (!income) {
    const created = await qboFetch(conn, '/account', {
      method: 'POST', body: JSON.stringify({ Name: 'Services', AccountType: 'Income' }),
    })
    income = created.Account as Entity
  }
  const created = await qboFetch(conn, '/item', {
    method: 'POST',
    body: JSON.stringify({
      Name: name, Type: 'Service', Taxable: false,
      IncomeAccountRef: { value: income.Id },
    }),
  })
  return (created.Item as Entity).Id
}

// ── Money flows ──────────────────────────────────────────────────────────────

export interface UsageLine {
  description: string
  amount: number
  /** Hours (Qty) and $/hr (UnitPrice) — posted when Qty × Rate matches the
   *  amount to the cent, so the books show the real math, not a lump sum. */
  quantity?: number
  rate?: number
}

/** Create a draft invoice: customer = job/zone name, one line per asset.
 *  Pure hourly lines post as Qty (hours) × UnitPrice (rate) for a clean audit
 *  trail; blended lines (hourly + mileage + ownership) fall back to Qty 1 with
 *  the math spelled out in the description. */
export async function createUsageInvoice(
  conn: LiveConnection,
  args: { customerName: string; memo: string; lines: UsageLine[]; serviceDateIso?: string }
): Promise<{ id: string; docNumber: string; total: number }> {
  const customerId = await findOrCreateCustomer(conn, args.customerName)
  const itemId = await findOrCreateServiceItem(conn)
  const serviceDate = args.serviceDateIso?.slice(0, 10)
  const body = {
    CustomerRef: { value: customerId },
    PrivateNote: args.memo.slice(0, 4000),
    Line: args.lines.map((l) => {
      const amount = Math.round(l.amount * 100) / 100
      // QBO validates Amount === Qty × UnitPrice; only split when it's exact.
      const exact = l.quantity != null && l.rate != null &&
        Math.abs(l.quantity * l.rate - amount) < 0.005
      return {
        Amount: amount,
        Description: l.description.slice(0, 4000),
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          Qty: exact ? l.quantity : 1,
          UnitPrice: exact ? l.rate : amount,
          ...(serviceDate ? { ServiceDate: serviceDate } : {}),
        },
      }
    }),
  }
  const created = await qboFetch(conn, '/invoice', { method: 'POST', body: JSON.stringify(body) })
  const inv = created.Invoice as { Id: string; DocNumber?: string; TotalAmt?: number }
  return { id: inv.Id, docNumber: inv.DocNumber ?? inv.Id, total: inv.TotalAmt ?? 0 }
}

/** Record a maintenance service as an expense (Purchase). Pays from the books'
 *  first Bank (else Credit Card) account into Repairs & Maintenance. */
export async function createServiceExpense(
  conn: LiveConnection,
  args: { vendorName: string; amount: number; dateIso: string; memo: string }
): Promise<{ id: string }> {
  const vendorId = await findOrCreateVendor(conn, args.vendorName || 'Service vendor')
  let payFrom = await firstAccount(conn, 'Bank')
  let paymentType: 'Cash' | 'CreditCard' = 'Cash'
  if (!payFrom) {
    payFrom = await firstAccount(conn, 'Credit Card')
    paymentType = 'CreditCard'
  }
  if (!payFrom) throw new Error('No Bank or Credit Card account in QuickBooks to pay from')
  let expense = await firstAccount(conn, 'Expense', 'Repair')
  if (!expense) expense = await firstAccount(conn, 'Expense')
  if (!expense) {
    const created = await qboFetch(conn, '/account', {
      method: 'POST',
      body: JSON.stringify({ Name: 'Repairs & Maintenance', AccountType: 'Expense' }),
    })
    expense = created.Account as Entity
  }
  const body = {
    PaymentType: paymentType,
    AccountRef: { value: payFrom.Id },
    EntityRef: { value: vendorId, type: 'Vendor' },
    TxnDate: args.dateIso.slice(0, 10),
    PrivateNote: args.memo.slice(0, 4000),
    Line: [{
      Amount: Math.round(args.amount * 100) / 100,
      DetailType: 'AccountBasedExpenseLineDetail',
      Description: args.memo.slice(0, 4000),
      AccountBasedExpenseLineDetail: { AccountRef: { value: expense.Id } },
    }],
  }
  const created = await qboFetch(conn, '/purchase', { method: 'POST', body: JSON.stringify(body) })
  return { id: (created.Purchase as Entity).Id }
}

/** Realm's company name, stored at connect time for the accounting page. */
export async function fetchCompanyName(conn: LiveConnection): Promise<string | null> {
  try {
    const j = await qboFetch(conn, `/companyinfo/${conn.realmId}`)
    return (j.CompanyInfo as { CompanyName?: string } | undefined)?.CompanyName ?? null
  } catch {
    return null
  }
}

// ── Demo-mode invoice preview (unchanged behavior for the demo site) ─────────

export function buildEquipmentUsageInvoice(
  jobSiteGeofenceId: string,
  jobSiteName: string,
  utilization: AssetUtilization[] = MOCK_UTILIZATION,
  rates: Record<string, number> = MOCK_EQUIPMENT_RATES
): QboInvoicePreview {
  const lines = utilization
    .map(u => {
      const site = u.job_site_hours.find(s => s.geofence_id === jobSiteGeofenceId)
      if (!site || site.hours <= 0) return null
      const rate = rates[u.asset_id] ?? 0
      return {
        description: `${u.asset_name} — equipment usage (${site.hours} hrs @ $${rate}/hr)`,
        quantity: site.hours,
        rate,
        amount: Math.round(site.hours * rate * 100) / 100,
      }
    })
    .filter((l): l is NonNullable<typeof l> => l !== null)

  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  return { customer: jobSiteName, job_site: jobSiteName, lines, total }
}

/** Demo stub kept for the demo accounting page's sync button. */
export async function syncAssetsAsFixedItems(): Promise<{ synced: number; demo: boolean }> {
  if (!isQboConfigured) {
    console.log('[QBO demo] would sync fixed assets:', MOCK_ASSETS.map(a => a.name))
    return { synced: MOCK_ASSETS.length, demo: true }
  }
  return { synced: 0, demo: false }
}
