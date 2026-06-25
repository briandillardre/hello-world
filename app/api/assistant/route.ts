import { NextRequest, NextResponse } from 'next/server'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { getAssetsWithLocations } from '@/lib/db/assets'
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

  const [rawAssets, geofences, alerts, toolAssociations] = await Promise.all([
    getAssetsWithLocations(MOCK_COMPANY.id),
    getGeofences(MOCK_COMPANY.id),
    getAlertEvents(MOCK_COMPANY.id),
    getToolAssociations(MOCK_COMPANY.id),
  ])
  const ctx: AssistantContext = {
    assets: resolveToolLocations(rawAssets, toolAssociations),
    geofences,
    projects: PROJECTS,
    alerts,
  }

  const grounded = answerQuestion(question, ctx)

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
