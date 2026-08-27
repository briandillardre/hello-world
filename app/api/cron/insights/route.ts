import { NextRequest, NextResponse } from 'next/server'
import { runInsightsEngine } from '@/lib/insights'
import { resolveDigestPrefs } from '@/lib/weekly-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Nightly insights run — rebuilds each company's daily metrics spine and
 * reconciles the detector findings (lib/insights.ts). Scheduled after the
 * hourly usage cron has rolled yesterday's ledger, so the money numbers the
 * detectors read are settled. The /api/insights GET also runs the engine
 * lazily when a company has no fresh spine (first deploy, missed night) —
 * this cron just keeps mornings warm.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (isMock) return NextResponse.json({ error: 'demo mode' }, { status: 501 })

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()
  const { data: companies } = await db.from('companies').select('id, name, digest_prefs').limit(50)
  const results: { company: string; fired: number }[] = []
  for (const co of companies ?? []) {
    try {
      const tz = resolveDigestPrefs(co.digest_prefs).tz
      const { fired } = await runInsightsEngine(db, co.id, tz)
      results.push({ company: co.name ?? co.id, fired })
    } catch (err) {
      console.error('Insights run failed for', co.id, err)
      results.push({ company: co.name ?? co.id, fired: -1 })
    }
  }
  return NextResponse.json({ ran: results.length, results })
}
