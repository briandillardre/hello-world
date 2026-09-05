/**
 * AI conversation visibility — strictly DOWN the ladder (Brian, Sep 4: "an
 * admin should be able to query a foreman's ai convos but not vice versa …
 * master admin should have context of everything").
 *
 * ai_messages RLS is per-user (014), so nobody reads anyone else's chat
 * through the normal client. This reader uses the service role and enforces
 * the rank rule itself: the actor must outrank the target (the Master
 * outranks everyone, including Admins). Equals cannot read each other.
 */
import { getRealPermissions } from '../permissions-server'
import { outranks, normalizeRole, type Role } from '../permissions'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export interface ConvoMessage { id: string; role: 'user' | 'assistant'; content: string; created_at: string }
export interface MemberConvos {
  ok: boolean
  error?: string
  member?: { id: string; name: string; role: Role }
  messages: ConvoMessage[]
}

export async function getMemberConversations(memberId: string, limit = 200): Promise<MemberConvos> {
  if (isMock) {
    return {
      ok: true,
      member: { id: memberId, name: 'Sarah Chen', role: 'foreman' },
      messages: [
        { id: '1', role: 'user', content: 'Where is the mini-ex?', created_at: new Date(Date.now() - 3_600_000).toISOString() },
        { id: '2', role: 'assistant', content: 'Takeuchi TB235 is at Creekside Phase 2, parked since 2:10 PM.', created_at: new Date(Date.now() - 3_599_000).toISOString() },
      ],
    }
  }
  const me = await getRealPermissions()
  if (!me.userId || !me.companyId) return { ok: false, error: 'Not signed in.', messages: [] }

  const { createServiceClient } = await import('../supabase-server')
  const svc = createServiceClient()
  const { data: target } = await svc.from('profiles').select('id, company_id, role, name').eq('id', memberId).maybeSingle()
  if (!target || target.company_id !== me.companyId) return { ok: false, error: 'Not on your team.', messages: [] }
  const role = normalizeRole(target.role, 'associate')
  const targetIsMaster = target.id === me.companyId
  if (!outranks(me, { role, isMaster: targetIsMaster })) return { ok: false, error: 'You can only read conversations of people below your level.', messages: [] }

  const { data } = await svc.from('ai_messages')
    .select('id, role, content, created_at')
    .eq('user_id', memberId).eq('company_id', me.companyId)
    .order('created_at', { ascending: false }).limit(limit)
  return {
    ok: true,
    member: { id: target.id, name: target.name || 'Teammate', role },
    messages: ((data ?? []) as ConvoMessage[]).reverse(),
  }
}
