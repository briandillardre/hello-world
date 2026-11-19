import { requireBetaTool } from '@/lib/beta/server'
import { activation, funnel, type CompanyFacts } from '@/lib/beta/activation'
import { ActivationView } from '@/components/beta/ActivationView'

export const metadata = { title: 'HammerTrack — Activation' }
export const dynamic = 'force-dynamic'

/**
 * Founder only (requireBetaTool('activation') 404s everyone else): every
 * company's first week, read on the service role — names of companies and
 * dates only, never a person.
 */
export default async function ActivationPage() {
  const { demo } = await requireBetaTool('activation')
  if (demo) return <ActivationView rows={[]} funnel={[]} />
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = createServiceClient()
  const { data: cos } = await svc.from('companies').select('id, name, created_at').order('created_at', { ascending: false }).limit(200)
  const first = async (table: string, col: string, id: string, extra?: (q: any) => any): Promise<string | null> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = svc.from(table).select(col).eq('company_id', id)
    if (extra) q = extra(q)
    const { data } = await q.order(col, { ascending: true }).limit(1)
    return ((data?.[0] as unknown as Record<string, string> | undefined)?.[col]) ?? null
  }
  const facts: CompanyFacts[] = await Promise.all((cos ?? []).map(async (c) => {
    const id = String(c.id)
    const [reg, wore, fix, site, people, clock, last, assets] = await Promise.all([
      first('device_onboarding', 'created_at', id),
      first('assets', 'created_at', id, (q) => q.not('tracker_id', 'is', null)),
      first('asset_locations', 'timestamp', id),
      first('geofences', 'created_at', id, (q) => q.eq('kind', 'site')),
      svc.from('profiles').select('created_at').eq('company_id', id).neq('role', 'prospect').order('created_at', { ascending: true }).limit(2),
      first('time_entries', 'clock_in_at', id),
      svc.from('asset_locations').select('timestamp').eq('company_id', id).order('timestamp', { ascending: false }).limit(1),
      svc.from('assets').select('id', { count: 'exact', head: true }).eq('company_id', id).eq('active', true),
    ])
    const tracker = [reg, wore].filter(Boolean).sort()[0] ?? null
    return {
      id, name: String(c.name ?? 'Company'), signup: String(c.created_at), tracker, fix, site,
      team: (people.data?.[1]?.created_at as string | undefined) ?? null, clock,
      lastFix: (last.data?.[0]?.timestamp as string | undefined) ?? null, assets: assets.count ?? 0,
    }
  }))
  const rows = facts.map((f) => activation(f, Date.now()))
  return <ActivationView rows={rows} funnel={funnel(rows)} />
}
