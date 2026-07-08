'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Copy, Check, Trash2, Shield, HardHat, Eye } from 'lucide-react'
import type { TeamData, Role } from '@/lib/db/team'
import { createInviteAction, revokeInviteAction, updateMemberRoleAction, removeMemberAction } from '@/lib/actions/team'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const ROLE_META: Record<Role, { label: string; hint: string; icon: typeof Shield; cls: string }> = {
  admin:   { label: 'Admin',   hint: 'Full access — billing, team, settings', icon: Shield,  cls: 'text-amber' },
  foreman: { label: 'Foreman', hint: 'Operate — edit assets, zones, alerts',   icon: HardHat, cls: 'text-teal' },
  viewer:  { label: 'Viewer',  hint: 'Read-only — see the map and reports',     icon: Eye,     cls: 'text-muted' },
}

export function TeamManager({ data }: { data: TeamData }) {
  const router = useRouter()
  const { members, invites, isAdmin } = data
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [busy, setBusy] = useState(false)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const linkFor = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/join?token=${token}`

  const invite = async () => {
    setBusy(true); setErr(null); setNewLink(null)
    try {
      const res = await createInviteAction(email, role)
      if ('error' in res) { setErr(res.error); return }
      setNewLink(linkFor(res.token))
      setEmail('')
      router.refresh()
    } finally { setBusy(false) }
  }

  const copy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1600) } catch { /* clipboard blocked */ }
  }

  const changeRole = async (id: string, r: Role) => { await updateMemberRoleAction(id, r); router.refresh() }
  const remove = async (id: string, name: string) => { if (confirm(`Remove ${name} from the team?`)) { await removeMemberAction(id); router.refresh() } }
  const revoke = async (id: string) => { await revokeInviteAction(id); router.refresh() }

  return (
    <div className="space-y-6">
      {/* Invite */}
      {isAdmin && (
        <section className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><UserPlus className="h-4 w-4 text-amber" /> Invite a teammate</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="name@company.com (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg bg-navy-950 border border-navy-700 text-ink text-sm px-3 py-2">
              {(['admin', 'foreman', 'viewer'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
            <Button onClick={invite} disabled={busy}>{busy ? 'Creating…' : 'Create invite'}</Button>
          </div>
          <p className="text-[11px] text-faint">{ROLE_META[role].hint}. You&rsquo;ll get a link to share — no email needed.</p>
          {err && <p className="text-xs text-alert">{err}</p>}
          {newLink && (
            <div className="rounded-lg border border-teal/30 bg-teal/10 p-3">
              <p className="text-xs text-teal font-medium mb-1.5">Invite ready — send this link:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] text-ink bg-navy-950 rounded px-2 py-1.5 break-all">{newLink}</code>
                <button onClick={() => copy(newLink, 'new')} className="flex-none inline-flex items-center gap-1 text-xs text-teal hover:underline">
                  {copied === 'new' ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Members */}
      <section>
        <h2 className="text-sm font-semibold text-faint uppercase tracking-wider mb-2">Members ({members.length})</h2>
        <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
          {members.map((m) => {
            const meta = ROLE_META[m.role]
            const Icon = meta.icon
            return (
              <div key={m.id} className="flex items-center gap-3 p-3.5">
                <div className="w-9 h-9 rounded-full bg-navy-800 grid place-items-center text-sm font-bold text-muted flex-none">
                  {(m.name || m.email || '?').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">{m.name}{m.isYou && <span className="text-faint font-normal"> · you</span>}</p>
                  {m.email && <p className="text-xs text-faint truncate">{m.email}</p>}
                </div>
                {isAdmin && !m.isYou ? (
                  <>
                    <select value={m.role} onChange={(e) => changeRole(m.id, e.target.value as Role)} className="rounded-md bg-navy-950 border border-navy-700 text-xs text-ink px-2 py-1.5">
                      {(['admin', 'foreman', 'viewer'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
                    </select>
                    <button onClick={() => remove(m.id, m.name)} className="text-faint hover:text-alert p-1" title="Remove"><Trash2 className="h-4 w-4" /></button>
                  </>
                ) : (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.cls}`}><Icon className="h-3.5 w-3.5" />{meta.label}</span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Pending invites */}
      {invites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider mb-2">Pending invites ({invites.length})</h2>
          <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{inv.email || 'Anyone with the link'}</p>
                  <p className="text-xs text-faint">{ROLE_META[inv.role].label} · expires {new Date(inv.expires_at).toLocaleDateString()}</p>
                </div>
                <button onClick={() => copy(linkFor(inv.token), inv.id)} className="inline-flex items-center gap-1 text-xs text-teal hover:underline">
                  {copied === inv.id ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Link</>}
                </button>
                {isAdmin && <button onClick={() => revoke(inv.id)} className="text-faint hover:text-alert p-1" title="Revoke"><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
        </section>
      )}

      {!isAdmin && <p className="text-xs text-faint">Only admins can invite or change roles. Ask an admin to update your access.</p>}
    </div>
  )
}
