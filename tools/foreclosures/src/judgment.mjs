// What is owed. Reads the Order/Judgment of Foreclosure and Sale (+ Form 4 cover)
// and returns the numbers an investor needs. Two passes: regex over the PDF text
// layer (free, deterministic), then Claude reading the actual PDF when
// ANTHROPIC_API_KEY is set (handles scans and the many ways clerks phrase it).
import Anthropic from '@anthropic-ai/sdk'
import { parseMoney, log } from './util.mjs'
import { detectDeficiency } from './notice.mjs'
import { pdfText } from './pdf.mjs'

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/g
const MONEY1 = new RegExp(MONEY.source)  // non-global copy for .match() (a /g regex drops the capture group)

export function regexJudgment(text) {
  const t = String(text).replace(/\s+/g, ' ')
  // amount that FOLLOWS the label (never look backwards – "costs of $250" must not pick up the total two lines up)
  const near = (re, span = 260) => { const m = t.match(re); if (!m) return null; let after = t.slice(m.index + m[0].length, m.index + m[0].length + span); const stop = after.search(/[.;]\s/); if (stop > 0) after = after.slice(0, stop + 1); const a = after.match(MONEY1); if (!a) return null; return { amount: parseMoney(a[1]), quote: t.slice(Math.max(0, m.index - 20), m.index + m[0].length + (a.index || 0) + a[0].length + 60).trim() } }
  const total = near(/(?:total (?:amount|sum|indebtedness|debt)(?: due| owed| owing)?|amount due (?:and owing|under the note)|judgment (?:against|in favor)[^$]{0,120}in the (?:total )?(?:amount|sum) of|is entitled to (?:a )?judgment[^$]{0,120}(?:amount|sum) of|indebted(?:ness)? to (?:the )?plaintiff[^$]{0,120}(?:amount|sum) of|balance due[^$]{0,80})/i)
  const DATE = '((?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},?\\s+\\d{4})'
  // the as-of date must sit in the same sentence as the total; a bare document-wide "as of" is the only fallback
  const asOf = ((total?.quote || '').match(new RegExp('(?:as of|through)\\s+' + DATE, 'i')) || t.match(new RegExp('as of\\s+' + DATE, 'i')) || [])[1] || ''
  const perDiem = (() => { const m = t.match(/\$\s?([\d,]+\.\d{2})\s+per (?:day|diem)/i); return m ? { amount: parseMoney(m[1]), quote: m[0] } : null })() || near(/per diem(?: interest)?(?: of| in the amount of| at the rate of| equal to| is)/i, 30)
  const rate = (t.match(/(?:interest (?:at|thereon at) the (?:contract |note )?rate of|rate of interest of)\s*([\d.]+\s*%|[\d.]+ percent)/i) || [])[1] || ''
  const fees = near(/attorney(?:'s|s'|s)? fees?(?: and costs)?(?: in the (?:amount|sum) of| of)?/i, 60)
  const costs = near(/(?:court )?costs(?: and disbursements)?(?: in the (?:amount|sum) of| of)(?! collection)/i, 40)
  const principal = near(/(?:unpaid )?principal(?: balance)?(?: in the (?:amount|sum) of| of| due)/i, 40)
  const escrow = near(/(?:escrow(?: advances?)?|advances? for taxes|taxes and insurance)(?: in the (?:amount|sum) of| of)?/i, 40)
  const form4 = near(/(?:FORM 4|JUDGMENT IN A CIVIL CASE)[\s\S]{0,600}?(?:amount|sum|judgment of)/i, 120)
  return {
    totalDebt: total?.amount ?? form4?.amount ?? null, totalQuote: total?.quote || form4?.quote || '', asOfDate: asOf,
    principal: principal?.amount ?? null, perDiem: perDiem?.amount ?? null, interestRate: rate, attorneyFees: fees?.amount ?? null, costs: costs?.amount ?? null, escrowAdvances: escrow?.amount ?? null,
    deficiency: detectDeficiency(t), extractedBy: 'regex',
    allAmounts: [...new Set([...t.matchAll(MONEY)].map(x => parseMoney(x[1])))].sort((a, b) => b - a).slice(0, 12),
  }
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['document_type', 'total_debt', 'as_of_date', 'per_diem', 'interest_rate', 'principal', 'attorney_fees', 'costs', 'escrow_advances', 'deficiency', 'judgment_date', 'senior_liens', 'notes', 'confidence'],
  properties: {
    document_type: { type: 'string', description: 'e.g. Order of Foreclosure and Sale, Form 4 Judgment, Notice of Sale, Deficiency order' },
    total_debt: { type: ['number', 'null'], description: 'Total amount the court found due to the plaintiff (the judgment / total indebtedness), in dollars' },
    as_of_date: { type: ['string', 'null'], description: 'Date the total is computed as of' },
    per_diem: { type: ['number', 'null'], description: 'Daily interest accruing after the as-of date, dollars' },
    interest_rate: { type: ['string', 'null'] }, principal: { type: ['number', 'null'] }, attorney_fees: { type: ['number', 'null'] }, costs: { type: ['number', 'null'] }, escrow_advances: { type: ['number', 'null'] },
    deficiency: { type: 'string', enum: ['waived', 'demanded', 'unknown'], description: 'Does the plaintiff waive its right to a deficiency judgment (sale final that day) or demand it (bidding stays open 30 days)?' },
    judgment_date: { type: ['string', 'null'] },
    senior_liens: { type: ['string', 'null'], description: 'Any mortgage/lien the property is sold SUBJECT TO, with amounts if stated' },
    notes: { type: 'string', description: 'One or two sentences a buyer must know: property description as stated, unusual terms, rights of redemption, mobile home, etc.' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
}

export async function aiJudgment({ buf, text, caseNo, label }) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null
  const client = new Anthropic()
  const model = process.env.FORECLOSURES_AI_MODEL || 'claude-opus-5'
  const content = []
  const isPdf = buf && buf.slice(0, 5).toString() === '%PDF-'
  if (isPdf && buf.length < 20 * 1024 * 1024) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
  else if (text) content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: text.slice(0, 200000) } })
  else return null
  content.push({ type: 'text', text: `This is a South Carolina foreclosure filing (${label || 'court document'}) for case ${caseNo}. Extract the judgment/debt figures and deficiency status for a prospective bidder at the Master-in-Equity sale. Use only what the document states; null when absent. Amounts in dollars as numbers.` })
  const req = { model, max_tokens: 4000, messages: [{ role: 'user', content }], output_config: { format: { type: 'json_schema', schema: SCHEMA } } }
  let res
  try { res = await client.messages.create(req) }
  catch (e) {
    if (e instanceof Anthropic.BadRequestError && /output_config|format/i.test(e.message)) { delete req.output_config; req.messages[0].content.push({ type: 'text', text: 'Reply with ONLY a JSON object matching: ' + JSON.stringify(SCHEMA.properties) }); res = await client.messages.create(req) }
    else throw e
  }
  if (res.stop_reason === 'refusal') return null
  const txt = res.content.filter(b => b.type === 'text').map(b => b.text).join('')
  const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
  return { totalDebt: j.total_debt, asOfDate: j.as_of_date || '', perDiem: j.per_diem, interestRate: j.interest_rate || '', principal: j.principal, attorneyFees: j.attorney_fees, costs: j.costs, escrowAdvances: j.escrow_advances, deficiency: j.deficiency, judgmentDate: j.judgment_date || '', seniorLiens: j.senior_liens || '', notes: j.notes || '', confidence: j.confidence, documentType: j.document_type, extractedBy: `ai:${model}` }
}

/** Best-effort judgment extraction from a downloaded document. */
export async function extractJudgment(doc, { caseNo, useAi = true } = {}) {
  let text = ''
  if (/pdf/i.test(doc.type) || (doc.buf && doc.buf.slice(0, 5).toString() === '%PDF-')) text = (await pdfText(doc.buf)).text
  const rx = text ? regexJudgment(text) : null
  let ai = null
  if (useAi) { try { ai = await aiJudgment({ buf: doc.buf, text, caseNo, label: doc.label || doc.description }) } catch (e) { log('  AI extraction failed:', e.message) } }
  const merged = ai ? Object.fromEntries([...new Set([...Object.keys(rx || {}), ...Object.keys(ai)])].map(k => [k, ai[k] != null && ai[k] !== 'unknown' && ai[k] !== '' ? ai[k] : rx?.[k]])) : null
  const best = merged && (merged.totalDebt != null || !rx?.totalDebt) ? merged : rx
  if (!best) return { extractedBy: 'none', needsOcr: !text, note: text ? '' : (process.env.ANTHROPIC_API_KEY ? 'document is not a text PDF (scan/TIFF) – open it and read the amount by hand' : 'document has no text layer and no AI key was set – open the PDF and read the amount by hand') }
  return { ...best, textChars: text.length, source: doc.url, sourceLabel: doc.label || doc.description || '' , needsOcr: !text && !ai }
}
