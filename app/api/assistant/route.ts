import { NextRequest, NextResponse } from 'next/server'
import { getAssetsWithLocations, getLocationHistory } from '@/lib/db/assets'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getGeofences } from '@/lib/db/geofences'
import { getAlertEvents } from '@/lib/db/alerts'
import { getToolAssociations, resolveToolLocations } from '@/lib/db/tools'
import { PROJECTS } from '@/lib/projects'
import { answerQuestion, type AssistantContext } from '@/lib/assistant'

export const dynamic = 'force-dynamic'

const SYSTEM = `You are HammerTrack's fleet assistant for a construction company owner.
Answer in 1-3 short, plain sentences like a sharp dispatcher who knows the yard.
You will be given the user's question, computed FACTS, and a draft answer.
Use ONLY the facts and draft — never invent asset names, counts, hours, or dollar figures.
If the draft already answers it, just tighten the wording. No preamble, no markdown headers.`

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
  const [rawAssets, geofences, alerts, toolAssociations, history] = await Promise.all([
    getAssetsWithLocations(companyId),
    getGeofences(companyId),
    getAlertEvents(companyId),
    getToolAssociations(companyId),
    getLocationHistory(companyId, new Date(Date.now() - 24 * 3_600_000).toISOString()),
  ])
  const ctx: AssistantContext = {
    assets: resolveToolLocations(rawAssets, toolAssociations),
    geofences,
    projects: PROJECTS,
    alerts,
  }

  const grounded = answerQuestion(question, ctx)

  // Enrich the facts with real last-24h movement per asset so questions like
  // "where did the truck go today" are answerable from telemetry.
  if (history?.length) {
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
      const name = ctx.assets.find((a) => a.id === assetId)?.name ?? assetId
      movement[name] = {
        milesLast24h: Math.round(miles * 10) / 10,
        activeHours: Math.round((activeMs / 3_600_000) * 10) / 10,
        firstMovement: firstMove,
        lastMovement: lastMove,
      }
    }
    ;(grounded.facts as Record<string, unknown>).movementLast24h = movement
  }

  // No API key → return the deterministic grounded answer (instant, free).
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ answer: grounded.answer, grounded: true })

  // With a key, let Claude phrase the grounded facts more naturally.
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: `Question: ${question}\n\nFACTS: ${JSON.stringify(grounded.facts)}\n\nDraft answer: ${grounded.answer}`,
        }],
      }),
    })
    if (!res.ok) return NextResponse.json({ answer: grounded.answer, grounded: true })
    const data = await res.json()
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim()
      : ''
    return NextResponse.json({ answer: text || grounded.answer, grounded: false })
  } catch {
    return NextResponse.json({ answer: grounded.answer, grounded: true })
  }
}
