import { cookies } from 'next/headers'
import { requireFeature } from '@/lib/permissions-server'
import { Activity, Bot, Users } from 'lucide-react'
import { safeTz } from '@/lib/dates'

export const metadata = { title: 'HammerTrack — Team activity' }

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

export const dynamic = 'force-dynamic'

interface Row { user_id: string; role: 'user' | 'assistant'; content: string; created_at: string }

/**
 * Team activity — the master-admin window into how the crew actually uses
 * the app (owner ask, Aug 6): who signs in, who leans on the AI and what
 * they ask it. Owner/admin only; everyone else gets a closed door.
 * AI threads are per-user under RLS, so this page reads through the service
 * client AFTER verifying the viewer's admin role server-side.
 */
export default async function ActivityPage() {
  await requireFeature('activity')
  const tz = safeTz(cookies().get('ht_tz')?.value)
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  if (isMock) {
    return (
      <Shell>
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          Demo mode — in the real app this shows each teammate&apos;s sign-ins and their AI questions.
        </p>
      </Shell>
    )
  }

  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: me } = user
    ? await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
    : { data: null }
  // OWNER only (Brian, Aug 22: "admin should get everything EXCEPT the
  // ability to see what everyone in the org has used the app for") — the
  // company founder is the one seat that may watch the team's app usage.
  const amOwner = (await requireFeature('activity')).isMaster
  if (!amOwner) {
    return (
      <Shell>
        <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
          Company owner only — this page shows the whole team&apos;s app + AI activity,
          so it stays with the person who owns the company.
        </p>
      </Shell>
    )
  }

  const companyId = me!.company_id
  const svc = createServiceClient()
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [{ data: members }, { data: msgs }] = await Promise.all([
    svc.from('profiles').select('id, name, email, role').eq('company_id', companyId),
    svc.from('ai_messages').select('user_id, role, content, created_at')
      .eq('company_id', companyId).gte('created_at', since30)
      .order('created_at', { ascending: true }).limit(2000),
  ])

  // Last sign-in per user via the auth admin API (service key) — tolerated
  // failure: the roster still renders without the column.
  const lastSeen = new Map<string, string>()
  try {
    const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 })
    for (const u of list?.users ?? []) {
      if (u.last_sign_in_at) lastSeen.set(u.id, u.last_sign_in_at)
    }
  } catch { /* auth admin unavailable — skip the column */ }

  const nameOf = (id: string) => members?.find((m) => m.id === id)?.name
    || members?.find((m) => m.id === id)?.email?.split('@')[0] || 'Teammate'

  const rows = (msgs ?? []) as Row[]
  const week = Date.now() - 7 * 86_400_000
  const byUser = new Map<string, { asks7: number; asks30: number; last: string | null }>()
  for (const m of members ?? []) byUser.set(m.id, { asks7: 0, asks30: 0, last: null })
  // Pair each question with the reply that followed it (per user, in order).
  const feed: { user_id: string; q: string; a: string | null; at: string }[] = []
  const pendingByUser = new Map<string, number>() // user_id → feed index awaiting a reply
  for (const r of rows) {
    if (r.role === 'user') {
      const s = byUser.get(r.user_id) ?? { asks7: 0, asks30: 0, last: null }
      s.asks30 += 1
      if (new Date(r.created_at).getTime() > week) s.asks7 += 1
      s.last = r.created_at
      byUser.set(r.user_id, s)
      feed.push({ user_id: r.user_id, q: r.content, a: null, at: r.created_at })
      pendingByUser.set(r.user_id, feed.length - 1)
    } else {
      const i = pendingByUser.get(r.user_id)
      if (i != null && feed[i] && feed[i].a === null) feed[i].a = r.content
      pendingByUser.delete(r.user_id)
    }
  }
  feed.reverse() // newest first
  const totalAsks7 = Array.from(byUser.values()).reduce((s, v) => s + v.asks7, 0)

  return (
    <Shell>
      {/* Roster: who's actually in the app */}
      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5 mb-2">
          <Users className="h-3.5 w-3.5" /> Team · {members?.length ?? 0} people · {totalAsks7} AI questions this week
        </h2>
        <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
          {(members ?? []).map((m) => {
            const s = byUser.get(m.id)
            const seen = lastSeen.get(m.id)
            return (
              <div key={m.id} className="px-3 py-2.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{m.name || m.email}</p>
                  <p className="text-[10.5px] font-mono text-faint uppercase tracking-[0.08em]">{m.role}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted">{s?.asks7 ?? 0} asks · 7d <span className="text-faint">({s?.asks30 ?? 0} · 30d)</span></p>
                  <p className="text-[10.5px] text-faint">{seen ? `signed in ${fmt(seen)}` : 'no sign-in data'}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* The feed: who asked the AI what, newest first */}
      <section>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-1.5 mb-2">
          <Bot className="h-3.5 w-3.5" /> AI questions · last 30 days
        </h2>
        {feed.length === 0 ? (
          <p className="text-sm text-faint rounded-xl border border-navy-800 bg-navy-900 p-4">
            Nobody has asked the AI anything in the last 30 days.
          </p>
        ) : (
          <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
            {feed.slice(0, 100).map((f, i) => (
              <details key={i} className="group">
                <summary className="px-3 py-2.5 cursor-pointer list-none hover:bg-navy-800/50">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-teal flex-none">{nameOf(f.user_id)}</span>
                    <span className="text-[10.5px] font-mono text-faint flex-none">{fmt(f.at)}</span>
                  </span>
                  <span className="block text-[13px] text-ink mt-0.5">{f.q.slice(0, 300)}</span>
                </summary>
                {f.a && (
                  <p className="px-3 pb-3 -mt-1 text-xs text-muted whitespace-pre-wrap border-l-2 border-navy-700 ml-3">
                    {f.a.slice(0, 1500)}{f.a.length > 1500 ? '…' : ''}
                  </p>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto pb-28 md:pb-10">
      <div className="p-4 border-b border-navy-800">
        <h1 className="font-display font-black text-2xl text-ink flex items-center gap-2">
          <Activity className="h-6 w-6 text-amber" /> Team activity
        </h1>
        <p className="text-sm text-faint mt-1">Who&apos;s in the app, and what they&apos;re asking the AI.</p>
      </div>
      <div className="p-4 space-y-6 max-w-3xl">{children}</div>
    </div>
  )
}
