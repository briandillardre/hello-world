/**
 * Phone normalization — humans type "(864) 915-2351", Twilio requires
 * "+18649152351", and nobody should have to know that (owner, Jul 31:
 * "no one is going to know to do this").
 *
 * US-defaulting on purpose: every customer today is a US contractor. A
 * number that already carries a + is trusted as-is, so international still
 * works for whoever types it explicitly.
 *
 * Shared by the settings write path, the alert send path, and the client
 * form — one definition, so what gets stored, compared, and dialed is
 * always the same string.
 */

/** → E.164, or null if it can't be one. Accepts any human formatting. */
export function normalizeUsPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Already explicit international — just strip separators.
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null
  }
  const digits = trimmed.replace(/\D/g, '')
  // 10-digit US number (area code can't start with 0/1).
  if (/^[2-9]\d{9}$/.test(digits)) return `+1${digits}`
  // 11 digits with the country code already typed.
  if (/^1[2-9]\d{9}$/.test(digits)) return `+${digits}`
  return null
}

/** E.164 → "(864) 915-2351" for display. Non-US passes through untouched. */
export function formatUsPhone(e164: string | null | undefined): string {
  if (!e164) return ''
  const m = e164.match(/^\+1([2-9]\d{2})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}
