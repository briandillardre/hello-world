/**
 * Minimal Plaid client over raw HTTPS — no SDK dependency. Server-only.
 * OPTIONAL: inert unless PLAID_CLIENT_ID + PLAID_SECRET are set (like QBO/Twilio).
 *
 * Env:
 *   PLAID_CLIENT_ID, PLAID_SECRET
 *   PLAID_ENV = sandbox | development | production   (default sandbox)
 *   PLAID_WEBHOOK_URL (optional) — where Plaid posts SYNC_UPDATES_AVAILABLE
 */

const CLIENT_ID = () => process.env.PLAID_CLIENT_ID
const SECRET = () => process.env.PLAID_SECRET
const ENV = () => (process.env.PLAID_ENV || 'sandbox').toLowerCase()

export function plaidEnabled(): boolean {
  return !!(CLIENT_ID() && SECRET())
}

function base(): string {
  const e = ENV()
  return e === 'production' ? 'https://production.plaid.com'
    : e === 'development' ? 'https://development.plaid.com'
    : 'https://sandbox.plaid.com'
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(base() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID(), secret: SECRET(), ...body }),
    signal: AbortSignal.timeout(20_000),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((json as { error_message?: string }).error_message || `Plaid ${path} ${res.status}`)
  }
  return json as T
}

/** A Link token the browser needs to open Plaid Link. */
export function createLinkToken(clientUserId: string): Promise<{ link_token: string; expiration: string }> {
  return call('/link/token/create', {
    user: { client_user_id: clientUserId },
    client_name: 'HammerTrack',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
    ...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {}),
  })
}

/** Trade the browser's public_token for a durable access_token + item_id. */
export function exchangePublicToken(publicToken: string): Promise<{ access_token: string; item_id: string }> {
  return call('/item/public_token/exchange', { public_token: publicToken })
}

export function getInstitutionName(accessToken: string): Promise<{ item: { institution_id?: string } }> {
  return call('/item/get', { access_token: accessToken })
}

export interface PlaidTxn {
  transaction_id: string
  name: string
  merchant_name?: string | null
  /** Plaid convention: POSITIVE = money OUT (a debit / charge). */
  amount: number
  date: string
  pending: boolean
  personal_finance_category?: { primary?: string } | null
}

export interface SyncResult {
  added: PlaidTxn[]
  modified: PlaidTxn[]
  removed: { transaction_id: string }[]
  next_cursor: string
  has_more: boolean
}

/** Incremental transaction pull. Loop while has_more, threading next_cursor. */
export function syncTransactions(accessToken: string, cursor?: string | null): Promise<SyncResult> {
  return call('/transactions/sync', { access_token: accessToken, ...(cursor ? { cursor } : {}), count: 250 })
}
