/**
 * Card-alert email parsing — pure functions, no I/O.
 *
 * Input: the instant transaction-alert email a card issuer sends the moment a
 * card is swiped (the customer forwards these to their company's inbound
 * address). Output: {merchant, amount, last4} — enough to open a chase.
 *
 * Formats drift and vary by product line, so parsing is layered: known issuer
 * shapes first (Chase, Capital One), then a tolerant generic pass that accepts
 * any email carrying a dollar amount plus card-ish context. When in doubt we
 * extract; a false positive is one bogus "needs receipt" row an admin deletes,
 * a false negative is a receipt lost forever.
 */

export interface ParsedCardAlert {
  merchant: string | null
  amount: number
  last4: string | null
  issuer: 'chase' | 'capital_one' | 'amex' | 'generic'
}

/** Strip HTML to text well enough for regex work (alerts are simple markup). */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
}

const AMOUNT_RE = /\$\s?([0-9][0-9,]*\.?[0-9]{0,2})/

function parseAmount(s: string | undefined): number | null {
  if (!s) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null
}

/** "ending in 1234" / "(...1234)" / "card ending 1234" / "**** 1234" */
function findLast4(text: string): string | null {
  const m =
    text.match(/ending\s+(?:in\s+)?(\d{4})/i) ??
    text.match(/\(\s*\.{2,}\s*(\d{4})\s*\)/) ??
    text.match(/[.*xX•]{2,}\s?(\d{4})\b/) ??
    text.match(/last\s+4[^0-9]{0,10}(\d{4})/i)
  return m ? m[1] : null
}

function cleanMerchant(raw: string | undefined): string | null {
  if (!raw) return null
  const m = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim()
    .slice(0, 80)
  // Reject fragments that are clearly sentence debris, not a merchant name.
  if (!m || /^(your|the|a|an|this|that|card|account)$/i.test(m)) return null
  return m
}

/** Chase: "You made a $84.12 transaction with LOWE'S #123" — merchant after
 *  "with"/"at", card as "(...4821)" or "ending in 4821". */
function parseChase(text: string): ParsedCardAlert | null {
  if (!/chase/i.test(text)) return null
  const m = text.match(
    /\$\s?([0-9][0-9,]*\.?[0-9]{0,2})\s+(?:transaction|purchase|charge)\s+(?:with|at|to)\s+(.{2,60}?)(?:\s+(?:on|was|from|using|exceeds|is)\b|[.\n]|$)/i
  )
  const amount = parseAmount(m?.[1])
  if (amount == null) return null
  return { merchant: cleanMerchant(m?.[2]), amount, last4: findLast4(text), issuer: 'chase' }
}

/** Capital One: "A transaction of $84.12 at LOWES #123 was charged to your
 *  card ending in 4821" (also "A purchase was made/approved …"). */
function parseCapitalOne(text: string): ParsedCardAlert | null {
  if (!/capital\s?one/i.test(text)) return null
  const m = text.match(
    /(?:transaction|purchase|charge)\s+(?:of|for)?\s*\$\s?([0-9][0-9,]*\.?[0-9]{0,2})\s+(?:at|with|from)\s+(.{2,60}?)(?:\s+(?:was|has|on)\b|[.\n]|$)/i
  )
  const amount = parseAmount(m?.[1] ?? text.match(AMOUNT_RE)?.[1])
  if (amount == null) return null
  return { merchant: cleanMerchant(m?.[2]), amount, last4: findLast4(text), issuer: 'capital_one' }
}

/** Amex: "A charge of $84.12 at LOWES was approved on your Card ending 4821". */
function parseAmex(text: string): ParsedCardAlert | null {
  if (!/american\s?express|amex/i.test(text)) return null
  const m = text.match(
    /(?:charge|purchase)\s+of\s+\$\s?([0-9][0-9,]*\.?[0-9]{0,2})\s+(?:at|with|from)\s+(.{2,60}?)(?:\s+(?:was|on)\b|[.\n]|$)/i
  )
  const amount = parseAmount(m?.[1] ?? text.match(AMOUNT_RE)?.[1])
  if (amount == null) return null
  return { merchant: cleanMerchant(m?.[2]), amount, last4: findLast4(text), issuer: 'amex' }
}

/** Any issuer: an amount plus card-alert context ("transaction/purchase/charge"
 *  near a dollar figure). Merchant is best-effort after at/with/to/from. */
function parseGeneric(text: string): ParsedCardAlert | null {
  if (!/(transaction|purchase|charge|debit)/i.test(text)) return null
  const amount = parseAmount(text.match(AMOUNT_RE)?.[1])
  if (amount == null) return null
  const m = text.match(
    /\$\s?[0-9][0-9,]*\.?[0-9]{0,2}[^\n]{0,40}?\b(?:at|with|to|from)\s+(.{2,60}?)(?:\s+(?:on|was|has|using|exceeds|with)\b|[.\n]|$)/i
  )
  return { merchant: cleanMerchant(m?.[1]), amount, last4: findLast4(text), issuer: 'generic' }
}

/**
 * Parse one inbound alert email. Subject often carries the whole story
 * ("Chase: You made a $84.12 transaction"), so it's prepended to the body.
 * Returns null when the email doesn't look like a transaction alert at all
 * (marketing mail, statements, OTP codes).
 */
export function parseCardAlert(input: { subject?: string | null; text?: string | null; html?: string | null; from?: string | null }): ParsedCardAlert | null {
  const body = (input.text?.trim() || htmlToText(input.html ?? '')).slice(0, 20_000)
  const text = `${input.from ?? ''}\n${input.subject ?? ''}\n${body}`
  // Not-a-transaction guards: statements, payment confirmations, verify codes.
  if (/statement is (?:ready|available)|payment (?:received|posted|due)|verification code|one-time code|autopay/i.test(text)) return null
  return parseChase(text) ?? parseCapitalOne(text) ?? parseAmex(text) ?? parseGeneric(text)
}

/** Company slug out of an inbound address: receipts-dillard@… / receipts+dillard@… → "dillard". */
export function slugFromInboundAddress(to: string): string | null {
  const m = to.toLowerCase().match(/receipts[-+]([a-z0-9-]{2,40})@/)
  return m ? m[1] : null
}
