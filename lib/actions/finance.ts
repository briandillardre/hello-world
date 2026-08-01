'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentCompanyId } from '@/lib/db/company'
import { getMyPermissions } from '@/lib/permissions-server'
import { TRADES, matchTradeByKeywords, type FinanceProfile } from '@/lib/valuation'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Classify a plain-English company description into a benchmark trade.
 * AI (Haiku) when the key is set; keyword rules otherwise — the page always
 * gets an answer. Returns the matched key plus a short display label drawn
 * from the owner's own words.
 */
export async function classifyCompanyAction(description: string): Promise<{
  ok: boolean; key?: string; label?: string; via?: 'ai' | 'keywords'; error?: string
}> {
  const desc = description.trim().slice(0, 600)
  if (desc.length < 8) return { ok: false, error: 'Describe the company in a sentence or two first.' }
  if (!(await getMyPermissions()).canViewCosts) return { ok: false, error: 'Owners and managers only.' }

  const fallback = () => {
    const t = matchTradeByKeywords(desc)
    return { ok: true as const, key: t.key, label: t.label, via: 'keywords' as const }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fallback()
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })
    const cats = TRADES.map((t) => `${t.key}: ${t.label}`).join('\n')
    const res = await client.messages.create({
      model: process.env.AI_MODEL_FAST || 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system:
        'You classify a company into ONE benchmark category for financial comparison. ' +
        'Reply with ONLY a JSON object {"key":"<category key>","label":"<3-6 word professional description of the company>"} — no prose. ' +
        'The key MUST be one of the provided keys. Pick by the company\'s DOMINANT revenue activity. ' +
        'The label paraphrases the owner\'s description (e.g. "Sitework & septic contractor"), never just repeats the category name unless nothing better fits.',
      messages: [{ role: 'user', content: `CATEGORIES:\n${cats}\n\nCOMPANY DESCRIPTION:\n${desc}` }],
    })
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    const j = m ? JSON.parse(m[0]) as { key?: string; label?: string } : null
    const valid = j?.key && TRADES.some((t) => t.key === j.key)
    if (!valid) return fallback()
    return { ok: true, key: j!.key, label: (j!.label || '').slice(0, 60) || undefined, via: 'ai' }
  } catch (err) {
    console.error('Company classification failed', err)
    return fallback()
  }
}

/** Save the admin-entered financial profile (Financials page). */
export async function saveFinanceProfileAction(p: FinanceProfile): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!(await getMyPermissions()).canManageBilling) {
    return { ok: false, error: 'You need the Billing permission (Team page) for this.' }
  }
  const num = (v: unknown): number | undefined => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : undefined
  }
  const clean: FinanceProfile = {
    industry: typeof p.industry === 'string' ? p.industry.slice(0, 30) : undefined,
    description: typeof p.description === 'string' ? p.description.trim().slice(0, 600) || undefined : undefined,
    industryLabel: typeof p.industryLabel === 'string' ? p.industryLabel.trim().slice(0, 60) || undefined : undefined,
    lastYearRevenue: num(p.lastYearRevenue),
    ytdRevenue: num(p.ytdRevenue),
    lastYearProfit: num(p.lastYearProfit),
    ownerComp: num(p.ownerComp),
    employees: num(p.employees),
    fleetValueOverride: num(p.fleetValueOverride),
    otherAssets: num(p.otherAssets),
    liabilities: num(p.liabilities),
  }
  const companyId = await getCurrentCompanyId()
  const { createClient } = await import('@/lib/supabase-server')
  const { error } = await createClient().from('companies')
    .update({ finance_profile: clean }).eq('id', companyId)
  if (error) return { ok: false, error: 'Save failed — run migration 048 in the Supabase SQL Editor first.' }
  revalidatePath('/finance')
  return { ok: true }
}
