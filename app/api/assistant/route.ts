import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAssetsWithLocations, getLocationHistory } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/geofences'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { PROJECTS } from '@/lib/projects'
import { answerQuestion, type AssistantContext } from '@/lib/assistant'
import { AI_TOOLS, runAiTool, type AiToolCtx } from '@/lib/ai-tools'
import { DEFAULT_TZ } from '@/lib/dates'

export const dynamic = 'force-dynamic'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

// The dispatcher persona. White-label rule is load-bearing: raw telemetry can
// contain vendor strings, and none of them may reach a customer's screen.
const SYSTEM = `You are HammerTrack's fleet assistant for a construction company owner.
Voice: a sharp dispatcher who knows the yard — plain sentences, no fluff, no markdown headers.
Ground rules:
- Use the tools for ANY question about locations, history, hours, visits, or alerts. Never guess numbers.
- If a tool returns an error listing valid names, retry once with the best match.
- Times from tools are already in the user's timezone — repeat them as given.
- Estimates (like fuel) must be labeled as estimates.
- NEVER mention GPS tracker hardware brands or model numbers, even if they appear in data.
- Keep answers to a few sentences unless listing visits/alerts the user asked for.
- You CAN see off-site stops: asset_stops classifies every 5+ minute stop (restaurant, supplier,
  fuel, DMV, dealer, store, residence). "Where did X eat lunch" -> call asset_stops. If earlier
  messages in this conversation claim you cannot see off-site stops, that was before the tool
  existed - you can now. Never refuse a stops/lunch/errand question without calling it.
- You CAN estimate arrivals: eta_to_zone gives distance and a rough ETA to any zone. Present it
  as approximate ("roughly 25 min if traffic behaves"), never as turn-by-turn certainty.
- Assets and zones may carry owner-written "notes" (engine type, gate codes, quirks). Treat
  notes as ground truth from the owner and use them when relevant.
- RIGHT-NOW questions ("what is X doing"): trust fleet_snapshot's "moving" and "stoppedAt"
  fields over the raw speed. If stoppedAt is set, the asset is parked THERE NOW — lead with
  "stopped at <place> for <minutes> min". A speedMph with lastReportAgeMinutes >= 3 is a STALE
  fix — trucks transmit constantly while driving, so silence after a moving fix means they
  almost certainly just parked; say "last reported doing 54 mph, 4 min ago — likely stopped
  since" instead of claiming they're on the road.`

interface HistoryRow { role: 'user' | 'assistant'; content: string }

/** Last N turns of this user's thread, oldest first. Empty when the table is
 *  missing (migration 014 not run), logged out, or demo mode. */
async function loadHistory(limit: number): Promise<{ userId: string | null; companyId: string | null; rows: HistoryRow[] }> {
  if (isMock) return { userId: null, companyId: null, rows: [] }
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { userId: null, companyId: null, rows: [] }
    const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
    const companyId = profile?.company_id ?? user.id
    const { data } = await supabase
      .from('ai_messages')
      .select('role, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)
    const rows = (data ?? []).reverse().filter(
      (r): r is HistoryRow => (r.role === 'user' || r.role === 'assistant') && typeof r.content === 'string'
    )
    return { userId: user.id, companyId, rows }
  } catch {
    return { userId: null, companyId: null, rows: [] }
  }
}

/** Best-effort persistence — chat still works if migration 014 isn't in yet. */
async function saveTurn(userId: string | null, companyId: string | null, question: string, answer: string): Promise<void> {
  if (!userId || !companyId || isMock) return
  try {
    const { createClient } = await import('@/lib/supabase-server')
    const supabase = createClient()
    await supabase.from('ai_messages').insert([
      { user_id: userId, company_id: companyId, role: 'user', content: question },
      { user_id: userId, company_id: companyId, role: 'assistant', content: answer },
    ])
  } catch { /* table absent or RLS denied — stateless is fine */ }
}

/** GET — the widget's thread on open. */
export async function GET() {
  const { rows } = await loadHistory(30)
  return NextResponse.json({ messages: rows.map((r) => ({ role: r.role, text: r.content })) })
}

export async function POST(request: NextRequest) {
  let question = ''
  try {
    const body = await request.json()
    question = typeof body?.question === 'string' ? body.question.slice(0, 500) : ''
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!question.trim()) return NextResponse.json({ error: 'Empty question' }, { status: 422 })

  // The bug that made this bot useless on live accounts: it queried with the
  // demo company id, so RLS returned zero rows ("0 of 0 assets").
  const companyId = await getCurrentCompanyId()
  const [rawAssets, geofences, alerts, toolAssociations] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getAlertEvents(companyId),
    getToolAssociations(companyId),
  ])
  const assets = resolveToolLocations(rawAssets, toolAssociations)
  const tz = decodeURIComponent(request.cookies.get('ht_tz')?.value ?? DEFAULT_TZ)

  const apiKey = process.env.ANTHROPIC_API_KEY

  // ── No API key → deterministic grounded engine (instant, free) ──
  if (!apiKey) {
    const ctx: AssistantContext = { assets, geofences, projects: PROJECTS, alerts }
    const grounded = answerQuestion(question, ctx)
    await enrichWithMovement(grounded, companyId, assets)
    return NextResponse.json({ answer: grounded.answer, grounded: true })
  }

  // ── With a key: real tool-use agent over live data ──
  const { userId, companyId: userCompanyId, rows: history } = await loadHistory(12)
  const toolCtx: AiToolCtx = { companyId, tz, assets, geofences, alerts }

  try {
    const client = new Anthropic({ apiKey })
    const model = process.env.AI_MODEL || 'claude-opus-4-8'
    const messages: Anthropic.MessageParam[] = [
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: question },
    ]

    let response = await client.messages.create({
      model,
      max_tokens: 1500,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      tools: AI_TOOLS as Anthropic.Tool[],
      messages,
    })

    // Agent loop — execute tool calls until the model answers in text.
    for (let turn = 0; turn < 6 && response.stop_reason === 'tool_use'; turn++) {
      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        const out = await runAiTool(block.name, (block.input ?? {}) as Record<string, unknown>, toolCtx)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) })
      }
      messages.push({ role: 'user', content: results })
      response = await client.messages.create({
        model,
        max_tokens: 1500,
        thinking: { type: 'adaptive' },
        system: SYSTEM,
        tools: AI_TOOLS as Anthropic.Tool[],
        messages,
      })
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()

    if (text) {
      await saveTurn(userId, userCompanyId, question, text)
      return NextResponse.json({ answer: text, grounded: false })
    }
  } catch (err) {
    console.error('Assistant agent error', err)
  }

  // Agent failed (bad key, outage, loop cap) → grounded fallback, never a 500.
  const ctx: AssistantContext = { assets, geofences, projects: PROJECTS, alerts }
  const grounded = answerQuestion(question, ctx)
  await saveTurn(userId, userCompanyId, question, grounded.answer)
  return NextResponse.json({ answer: grounded.answer, grounded: true })
}

/** Legacy enrichment for the no-key path: last-24h movement per asset so
 *  "where did the truck go today" is answerable from the draft facts. */
async function enrichWithMovement(
  grounded: { facts: Record<string, unknown> },
  companyId: string,
  assets: { id: string; name: string }[]
): Promise<void> {
  const history = await getLocationHistory(companyId, new Date(Date.now() - 24 * 3_600_000).toISOString())
  if (!history?.length) return
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const byAsset = new Map<string, typeof history>()
  for (const r of history) {
    if (!byAsset.has(r.asset_id)) byAsset.set(r.asset_id, [])
    byAsset.get(r.asset_id)!.push(r)
  }
  const movement: Record<string, unknown> = {}
  for (const [assetId, rowsRaw] of Array.from(byAsset.entries())) {
    const rows = rowsRaw.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    let miles = 0
    let activeMs = 0
    let firstMove: string | null = null
    let lastMove: string | null = null
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]
      const dt = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      if (dt <= 0 || dt > 10 * 60_000) continue
      const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
      const meters = 2 * R * Math.asin(Math.sqrt(h))
      if ((b.speed ?? 0) > 1 || meters > 25) {
        miles += meters / 1609.34
        activeMs += dt
        if (!firstMove) firstMove = b.timestamp
        lastMove = b.timestamp
      }
    }
    const name = assets.find((a) => a.id === assetId)?.name ?? assetId
    movement[name] = {
      milesLast24h: Math.round(miles * 10) / 10,
      activeHours: Math.round((activeMs / 3_600_000) * 10) / 10,
      firstMovement: firstMove,
      lastMovement: lastMove,
    }
  }
  grounded.facts.movementLast24h = movement
}
