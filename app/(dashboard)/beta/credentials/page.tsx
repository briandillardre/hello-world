import { requireBetaTool } from '@/lib/beta/server'
import { companyPeople, companyToday, listRecords } from '@/lib/db/beta'
import { rankOf, RANK, outranks, normalizeRole } from '@/lib/permissions'
import { createClient } from '@/lib/supabase-server'
import { CredentialsView } from '@/components/beta/CredentialsView'

export const metadata = { title: 'HammerTrack — Crew cards' }
export const dynamic = 'force-dynamic'

export default async function CredentialsPage() {
  const { perms, companyId, canWrite, demo } = await requireBetaTool('credentials')
  const [{ today }, recs, people] = await Promise.all([companyToday(companyId), listRecords(companyId, ['credential'], { limit: 3000 }), companyPeople(companyId)])
  let me: string | null = null
  if (!demo) { const { data: { user } } = await createClient().auth.getUser(); me = user?.id ?? null }
  // a preview shows the previewed person's own cards only, as they would see them
  const viewer = perms.viewingAs?.id ?? me
  const seesAll = rankOf(perms) >= RANK.foreman
  const rows = seesAll ? recs.rows : recs.rows.filter((r) => r.personId === viewer)
  // who the caller may add cards for: themselves, and (Foreman+) the people below them
  const addFor = people.filter((p) => p.id === viewer || (seesAll && outranks(perms, { role: normalizeRole(p.role, 'associate'), isMaster: p.id === companyId })))
  return <CredentialsView rows={rows} people={people.map(({ id, name }) => ({ id, name }))} addFor={addFor.map(({ id, name }) => ({ id, name }))} me={viewer} today={today} demo={demo}
    seesAll={seesAll} canWrite={canWrite} canRemoveAny={rankOf(perms) >= RANK.manager} />
}
