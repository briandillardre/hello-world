import type { QboInvoicePreview, AssetUtilization } from './types'
import { MOCK_QBO_CONNECTION, MOCK_UTILIZATION, MOCK_EQUIPMENT_RATES, MOCK_ASSETS } from './mock-data'

export const isQboConfigured = !!process.env.QBO_CLIENT_ID

const QBO_AUTH_BASE = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_SCOPES = 'com.intuit.quickbooks.accounting'

/** Build the Intuit OAuth2 authorization URL. */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID ?? '',
    response_type: 'code',
    scope: QBO_SCOPES,
    redirect_uri: process.env.QBO_REDIRECT_URI ?? '',
    state,
  })
  return `${QBO_AUTH_BASE}?${params.toString()}`
}

export interface QboTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  realmId?: string
}

/** Exchange an authorization code for tokens (Intuit token endpoint). */
export async function exchangeCodeForTokens(code: string): Promise<QboTokenResponse> {
  const tokenUrl = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
  const basic = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString('base64')

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI ?? '',
    }),
  })
  if (!res.ok) throw new Error(`QBO token exchange failed: ${res.status}`)
  return res.json()
}

/** Connection status — demo connection when QBO isn't configured. */
export function getConnectionStatus() {
  if (!isQboConfigured) {
    return { connected: true, demo: true, connection: MOCK_QBO_CONNECTION }
  }
  // In production, look up qbo_connections for the company.
  return { connected: false, demo: false, connection: null }
}

/** Sync TrackFlow assets as QuickBooks fixed-asset items. */
export async function syncAssetsAsFixedItems(): Promise<{ synced: number; demo: boolean }> {
  if (!isQboConfigured) {
    // Demo: log what we WOULD send to QBO.
    console.log('[QBO demo] would sync fixed assets:', MOCK_ASSETS.map(a => a.name))
    return { synced: MOCK_ASSETS.length, demo: true }
  }
  // Production: POST each asset to /v3/company/{realmId}/item
  return { synced: 0, demo: false }
}

/**
 * Build a billable equipment-usage invoice for a job site (geofence) from
 * utilization data × per-asset hourly rates.
 */
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

/** Record a service record as a QuickBooks expense (demo logs the payload). */
export async function recordServiceExpense(
  serviceRecordId: string,
  amount: number,
  vendor: string
): Promise<{ ok: boolean; demo: boolean }> {
  if (!isQboConfigured) {
    console.log(`[QBO demo] would record expense $${amount} to ${vendor} (svc ${serviceRecordId})`)
    return { ok: true, demo: true }
  }
  return { ok: false, demo: false }
}
