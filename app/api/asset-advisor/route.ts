import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * AI asset advisor — infers the boring-but-useful numbers from what's already
 * been entered (year/make/model/engine/type), so the owner doesn't hand-type
 * them:
 *   • service specs  — oil grade, oil/air filter part #s, factory tire size
 *   • cost structure — operating $/hr, $/mile, ownership $/day, replacement $
 *   • value_range    — fair US used-market range
 *
 * Best-effort and clearly an estimate. Returns 501 when ANTHROPIC_API_KEY isn't
 * set. The form applies whichever slice the owner asked for (service vs cost);
 * cost is the last thing edited, after the identity is filled in.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI key not configured' }, { status: 501 })

  let body: { name?: string; type?: string; specs?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const name = String(body?.name ?? '').slice(0, 120)
  const type = String(body?.type ?? 'vehicle')
  const specs = body?.specs ?? {}
  if (!name.trim() && !Object.keys(specs).length) {
    return NextResponse.json({ error: 'Enter the asset name or year/make/model first.' }, { status: 422 })
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: process.env.AI_MODEL || 'claude-opus-4-8',
      max_tokens: 600,
      system:
        'You advise a construction fleet owner on a single asset. From the identity given (year/make/model/engine/type), return ONLY a JSON object:\n' +
        '{"service":{"oil":"","oil_filter":"","air_filter":"","tires":""},' +
        '"costs":{"hourly_rate":0,"mileage_rate":0,"daily_cost":0,"purchase_value":0},' +
        '"value_range":"$X–$Y","note":"one short sentence"}\n' +
        'Rules: Use real factory specs for THIS make/model/engine (e.g. a diesel pickup takes 15W-40 or a specific low-ash oil, a real filter part number, the OE tire size). ' +
        'Costs are US dollars: hourly_rate = fuel+wear while operating; mileage_rate = per-mile all-in (IRS-style) for on-road vehicles only; daily_cost = ownership/day (payment+insurance+depreciation); purchase_value = current replacement cost. ' +
        'Equipment has no mileage_rate. Personnel: only hourly_rate (loaded labor). Tools: only purchase_value. ' +
        'OMIT any field you are not reasonably confident about (use null), never guess a part number you do not know. Keep value_range realistic for the age/condition.',
      messages: [{
        role: 'user',
        content: `Type: ${type}\nName: ${name}\nKnown specs: ${JSON.stringify(specs)}\nAssume average condition for its age unless specs say otherwise.`,
      }],
    })
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    if (!parsed) return NextResponse.json({ error: 'Could not read a suggestion.' }, { status: 422 })

    // Sanitize: keep only strings for service, non-negative finite numbers for costs.
    const service: Record<string, string> = {}
    for (const k of ['oil', 'oil_filter', 'air_filter', 'tires']) {
      const v = parsed.service?.[k]
      if (typeof v === 'string' && v.trim() && v.toLowerCase() !== 'null') service[k] = v.trim()
    }
    const costs: Record<string, number> = {}
    for (const k of ['hourly_rate', 'mileage_rate', 'daily_cost', 'purchase_value']) {
      const v = parsed.costs?.[k]
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN
      if (Number.isFinite(n) && n > 0) costs[k] = n
    }
    return NextResponse.json({
      service,
      costs,
      value_range: parsed.value_range && String(parsed.value_range).toLowerCase() !== 'null' ? String(parsed.value_range) : null,
      note: parsed.note ? String(parsed.note) : '',
    })
  } catch (err) {
    console.error('Asset advisor failed', err)
    return NextResponse.json({ error: 'advisor failed' }, { status: 500 })
  }
}
