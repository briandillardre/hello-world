import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // adaptive thinking can take a few seconds

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
    // Stream to the final message — adaptive thinking + a 2k budget can run long
    // enough to trip a non-streaming request timeout.
    const res = await client.messages.stream({
      model: process.env.AI_MODEL || 'claude-opus-4-8',
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      system:
        'You advise a US construction fleet owner on ONE asset. Be a careful estimator: derive every cost from a consistent method so two similar vehicles get similar numbers. Return ONLY a JSON object:\n' +
        '{"service":{"oil":"","oil_capacity":"","oil_filter":"","air_filter":"","fuel_filter":"","hydraulic_oil":"","hydraulic_filter":"","coolant":"","tires":""},' +
        '"costs":{"hourly_rate":0,"mileage_rate":0,"daily_cost":0,"purchase_value":0},' +
        '"value_range":"$X–$Y","note":"assumptions in one or two sentences"}\n' +
        '\nAnchors (mid-2026 US): diesel ≈ $4.00/gal, gasoline ≈ $3.30/gal, IRS standard mileage ≈ $0.70/mi. Round money to sensible increments.\n' +
        '\nMETHOD — compute, do not guess:\n' +
        '• value_range = fair current used-market range for this year/make/model/mileage-for-age. purchase_value = midpoint replacement cost (same basis).\n' +
        '• mileage_rate ($/mi, on-road vehicles only) = fuel/mi (fuel price ÷ real MPG) + maintenance&tires/mi (~$0.10–0.20 light truck) + depreciation/mi. A DEPRECIATED older truck has LOW depreciation/mi, so its $/mi should be LOWER than a newer same-class truck, not higher. Typical light-truck all-in lands $0.55–0.95/mi; keep near the IRS anchor unless MPG/price justifies otherwise.\n' +
        '• hourly_rate ($/operating-hr) = fuel burn/hr (pickups ~2–4 gal/hr; bigger diesels more) × fuel price + wear. Most pickups land ~$10–18/hr; do not output $5 for one truck and $18 for a similar one.\n' +
        '• daily_cost ($/day ownership) = (annual depreciation + insurance + registration + financing IF likely financed) ÷ 365. A cheap paid-off older truck is low ($8–20); a newer/financed one is higher ($30–60). Scale it to purchase_value, not at random.\n' +
        '• service specs: real factory numbers for THIS machine. oil = grade (e.g. diesel 15W-40 or the spec low-ash oil); oil_capacity = crankcase fill with filter (e.g. "9.5 qt"); fuel_filter/oil_filter/air_filter = real OE part #s; hydraulic_oil = the spec fluid for equipment (e.g. ISO 46 / Kubota UDT2 / Cat HYDO); hydraulic_filter = OE part # if known; coolant = spec type; tires = OE size. Vehicles usually have no hydraulic entries; small tools usually have none of these. NEVER invent a part number or capacity — null anything you cannot ground for this exact engine/machine.\n' +
        '\nField applicability: equipment has NO mileage_rate; personnel only hourly_rate (loaded labor = wage + burden); tools only purchase_value. Use null for anything you cannot ground. In "note", state the key assumptions you used (MPG, fuel, whether financed) so the owner can sanity-check.',
      messages: [{
        role: 'user',
        content: `Type: ${type}\nName: ${name}\nKnown specs: ${JSON.stringify(specs)}\nAssume average condition and average annual miles/hours for its age unless the specs say otherwise. Think through the method for each field, then output the JSON.`,
      }],
    }).finalMessage()
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    if (!parsed) return NextResponse.json({ error: 'Could not read a suggestion.' }, { status: 422 })

    // Sanitize: keep only strings for service, non-negative finite numbers for costs.
    const service: Record<string, string> = {}
    for (const k of ['oil', 'oil_capacity', 'oil_filter', 'air_filter', 'fuel_filter', 'hydraulic_oil', 'hydraulic_filter', 'coolant', 'tires']) {
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
