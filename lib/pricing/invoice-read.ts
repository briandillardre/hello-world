/**
 * A supplier invoice's PDF or photo → the raw draft object, via Claude (the
 * lib/receipts/extract.ts pattern). Never guesses: anything not clearly
 * legible comes back null, and the reply goes through `cleanDraft` before
 * anyone sees it. Throws `InvoiceReadUnavailable` when no AI key is set (the
 * action turns that into "type it in"), and plain errors on SDK/network
 * failures.
 */

export class InvoiceReadUnavailable extends Error {
  constructor() { super('Invoice reading is not set up.'); this.name = 'InvoiceReadUnavailable' }
}

/** What Claude can read: PDFs as documents, these as images (HEIC is not one). */
export const READABLE_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

const SYSTEM =
  'You read supplier invoices and delivery/scale tickets for a sitework and paving contractor ' +
  '(quarries, asphalt plants, concrete plants, material suppliers). Reply with ONLY one JSON object, no prose:\n' +
  '{"vendorName":string|null,"invoiceNo":string|null,"invoiceOn":"YYYY-MM-DD"|null,"dueOn":"YYYY-MM-DD"|null,' +
  '"termsDays":number|null,"freight":number|null,"fuel":number|null,"tax":number|null,"total":number|null,' +
  '"delivered":boolean,"lines":[{"description":string,"qty":number|null,"unit":string|null,"unitPrice":number|null,' +
  '"amount":number|null,"ticket":string|null}]}\n' +
  'Rules: vendorName = the company that issued the invoice (not the customer, not "remit to" bank). ' +
  'lines = MATERIAL lines only (stone, asphalt mix, concrete, fill, pipe…), one per printed line or ticket, ' +
  'with the material name exactly as printed in description, quantity, unit as printed (TON, TN, CY, YD, LF, EA, LOAD…), ' +
  'unit price and extended amount. Freight / delivery / hauling / trucking charges go in "freight" (summed), ' +
  'fuel surcharges in "fuel" (summed), sales tax in "tax" — never as lines. total = the invoice total due. ' +
  'termsDays = the payment terms in days ("Net 30" = 30) when printed. delivered = true only if the paper says ' +
  'the price is delivered / FOB job site. Numbers are plain numbers (no $ or commas); a credit is negative. ' +
  'Null anything you cannot read confidently — never guess, never compute a value that is not printed. ' +
  'If the document is not an invoice or ticket, reply {"lines":[]}.'

export async function readInvoice(file: { data: Buffer | Uint8Array; mediaType: string }, opts: { model?: string } = {}): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new InvoiceReadUnavailable()
  const isPdf = file.mediaType === 'application/pdf'
  if (!isPdf && !(READABLE_IMAGES as readonly string[]).includes(file.mediaType)) throw new Error('unsupported type')
  const data = Buffer.from(file.data).toString('base64')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })
  const block = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: file.mediaType as 'image/jpeg', data } }
  const res = await client.messages.create({
    model: opts.model || process.env.AI_MODEL || 'claude-sonnet-5',
    max_tokens: 4096,
    system: SYSTEM,
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this invoice.' }] }],
  })
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return { lines: [] }
  try {
    const j = JSON.parse(m[0]) as unknown
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : { lines: [] }
  } catch {
    return { lines: [] }
  }
}
