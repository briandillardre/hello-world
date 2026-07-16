/**
 * Receipt image → structured fields, via Claude vision. Portable: the only
 * dependency is the Anthropic SDK + an API key, so this drops into any app that
 * needs to read receipts/invoices. No DB, no framework.
 */

export interface ReceiptFields {
  vendor: string | null
  /** Final total paid. */
  amount: number | null
  /** YYYY-MM-DD. */
  date: string | null
  category: 'fuel' | 'materials' | 'repairs' | 'meals' | 'tools' | 'other' | null
  /** Last 4 of the card, when printed — used to attribute the charge. */
  last4: string | null
  /** Sales tax portion, when itemized. */
  tax: number | null
}

export interface ExtractInput {
  /** Base64 (no data: prefix) or raw bytes. */
  data: string | Buffer | Uint8Array
  /** e.g. 'image/jpeg' | 'image/png' | 'image/webp' */
  mediaType: string
}

const EMPTY: ReceiptFields = { vendor: null, amount: null, date: null, category: null, last4: null, tax: null }

function toBase64(d: string | Buffer | Uint8Array): string {
  if (typeof d === 'string') return d
  return Buffer.from(d).toString('base64')
}

/**
 * Read a receipt photo into fields. Never guesses — anything not clearly legible
 * comes back null. Throws only on a hard SDK/network failure; a readable-but-
 * empty receipt returns EMPTY.
 */
export async function extractReceiptFields(
  image: ExtractInput,
  opts: { apiKey: string; model?: string }
): Promise<ReceiptFields> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey: opts.apiKey })
  const res = await client.messages.create({
    model: opts.model || process.env.AI_MODEL || 'claude-opus-4-8',
    max_tokens: 400,
    system:
      'You read receipt/invoice photos for a business\'s books. Reply with ONLY JSON:\n' +
      '{"vendor":string|null,"amount":number|null,"date":"YYYY-MM-DD"|null,' +
      '"category":"fuel"|"materials"|"repairs"|"meals"|"tools"|"other"|null,' +
      '"last4":string|null,"tax":number|null}\n' +
      'amount = the FINAL total paid. last4 = the last 4 digits of the card if printed (e.g. "1234"), else null. ' +
      'tax = sales tax portion if itemized, else null. Null anything you cannot read confidently — never guess.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/jpeg', data: toBase64(image.data) } },
        { type: 'text', text: 'Extract this receipt.' },
      ],
    }],
  })
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { ...EMPTY }
  let j: Record<string, unknown>
  try { j = JSON.parse(m[0]) } catch { return { ...EMPTY } }

  const str = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const cat = str(j.category, 40) as ReceiptFields['category']
  const last4 = typeof j.last4 === 'string' ? (j.last4.match(/\d{4}/)?.[0] ?? null) : null
  return {
    vendor: str(j.vendor),
    amount: numOrNull(j.amount),
    date: str(j.date, 10),
    category: cat,
    last4,
    tax: numOrNull(j.tax),
  }
}
