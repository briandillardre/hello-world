import { requireFeature } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import { TOOLS } from '@/lib/beta/tools'
import { isFounder, isMockMode } from '@/lib/beta/server'
import { companyToday, listRecords } from '@/lib/db/beta'
import { dueState } from '@/lib/beta/registers'
import { BetaHub } from '@/components/beta/BetaHub'

export const metadata = { title: 'HammerTrack — Beta' }
export const dynamic = 'force-dynamic'

/** The Beta section (migration 162): tools being tried out, each riding data HammerTrack already holds. */
export default async function BetaPage() {
  const perms = await requireFeature('beta')
  const companyId = await getCurrentCompanyId()
  const founder = perms.isMaster && !perms.viewingAs && await isFounder(companyId)
  const tools = TOOLS.filter((t) => t.canOpen(perms, founder))
  // what's due across the registers the caller can read (RLS decides which)
  const [{ today }, recs] = await Promise.all([companyToday(companyId), listRecords(companyId, ['locate', 'rental', 'credential'], { limit: 2000 })])
  const due: Record<string, { overdue: number; soon: number }> = {}
  const keyOf = { locate: 'locates', rental: 'rentals', credential: 'credentials' } as Record<string, string>
  for (const r of recs.rows) {
    const k = keyOf[r.kind]
    if (!k || r.status === 'closed') continue
    const s = dueState(r.dueOn, today, r.kind === 'locate' ? 3 : 30)
    if (s !== 'overdue' && s !== 'soon') continue
    // a rental called off has no due day; a credential with no expiry has none
    due[k] = due[k] ?? { overdue: 0, soon: 0 }
    due[k][s]++
  }
  return <BetaHub tools={tools.map((t) => ({ key: t.key, href: t.href, title: t.title, blurb: t.blurb, group: t.group }))} due={due} demo={isMockMode} />
}
