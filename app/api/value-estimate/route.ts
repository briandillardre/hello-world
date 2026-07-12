import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * AI market-value range for an asset. There is no free comps database for
 * used iron (the real ones are paid subscriptions), so this asks the model
 * for a fair auction/private-party range from year/make/model/condition —
 * clearly labeled an estimate, stored in specs as `value_range`.
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI key not configured' }, { status: 501 })

  let body: { name?: string; specs?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const name = String(body?.name ?? '').slice(0, 120)
  if (!name.trim()) return NextResponse.json({ error: 'name required' }, { status: 422 })

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: process.env.AI_MODEL || 'claude-opus-4-8',
      max_tokens: 300,
      system:
        'You estimate US used-market value ranges for construction vehicles and equipment. Reply with ONLY a JSON object: {"range":"$X–$Y","note":"one short sentence on the main value driver"}. Round to sensible increments. If the item is too ambiguous to price, use {"range":null,"note":"why"}.',
      messages: [{
        role: 'user',
        content: `Item: ${name}\nKnown specs: ${JSON.stringify(body?.specs ?? {})}\nAssume average condition for its age unless specs say otherwise.`,
      }],
    })
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    if (!parsed?.range) return NextResponse.json({ error: parsed?.note ?? 'Could not estimate' }, { status: 422 })
    return NextResponse.json({ range: String(parsed.range), note: String(parsed.note ?? '') })
  } catch (err) {
    console.error('Value estimate failed', err)
    return NextResponse.json({ error: 'estimate failed' }, { status: 500 })
  }
}
