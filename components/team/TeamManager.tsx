'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus, Copy, Check, Trash2, Shield, HardHat, Eye, Briefcase, SlidersHorizontal, DollarSign, Receipt, Users, Mail } from 'lucide-react'
import type { TeamData, Role, TeamMember } from '@/lib/db/team'
import { createInviteAction, emailInviteAction, revokeInviteAction, updateMemberRoleAction, removeMemberAction, updateMemberOverridesAction } from '@/lib/actions/team'
import { ROLE_DEFAULTS } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const ROLE_META: Record<Role, { label: string; hint: string; icon: typeof Shield; cls: string }> = {
  admin:   { label: 'Admin',   hint: 'Full access — billing, team, settings',     icon: Shield,    cls: 'text-amber' },
  manager: { label: 'Manager', hint: 'Full operations + costs — no billing/team', icon: Briefcase, cls: 'text-[#60a5fa]' },
  foreman: { label: 'Foreman', hint: 'Operate — edit assets, zones, alerts; no $', icon: HardHat,   cls: 'text-teal' },
  viewer:  { label: 'Viewer',  hint: 'Read-only — see the map, no costs',          icon: Eye,       cls: 'text-muted' },
}

const ALL_ROLES: Role[] = ['admin', 'manager', 'foreman', 'viewer']

// The three sensitive-info toggles an admin can override per person.
const OVERRIDES = [
  { key: 'can_view_costs' as const,     label: 'See $ costs',   icon: DollarSign },
  { key: 'can_manage_billing' as const, label: 'Billing & QBO', icon: Receipt },
  { key: 'can_manage_team' as const,    label: 'Manage team',   icon: Users },
]

export function TeamManager({ data }: { data: TeamData }) {
  const router = useRouter()
  const { members, invites, isAdmin } = data
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [busy, setBusy] = useState(false)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sentNote, setSentNote] = useState<string | null>(null)
  const [emailing, setEmailing] = useState<string | null>(null)

  const linkFor = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/join?token=${token}`

  const invite = async () => {
    setBusy(true); setErr(null); setNewLink(null)
    try {
      const to = email.trim()
      const res = await createInviteAction(email, role)
      if ('error' in res) { setErr(res.error); return }
      setNewLink(linkFor(res.token))
      if (res.emailed) setSentNote(`Invite emailed to ${to} — link below if you want to text it too.`)
      else if (res.emailError === 'not configured' && to) setSentNote('Email sending isn\u2019t set up yet (RESEND_API_KEY) — copy the link below and send it yourself.')
      else if (res.emailError && to) setSentNote(`Couldn\u2019t email the invite (${res.emailError}) — copy the link below instead.`)
      else setSentNote(null)
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
              {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
            <Button onClick={invite} disabled={busy}>{busy ? 'Creating…' : 'Create invite'}</Button>
          </div>
          <p className="text-[11px] text-faint">{ROLE_META[role].hint}. With an email, the invite sends itself; leave it blank for a share link.</p>
          {err && <p className="text-xs text-alert">{err}</p>}
          {sentNote && <p className="text-xs text-teal">{sentNote}</p>}
          {newLink && (
            <div className="rounded-lg border border-teal/30 bg-teal/10 p-3">
              <p className="text-xs text-teal font-medium mb-1.5">Invite link:</p>
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
          {members.map((m) => (
            <MemberRow key={m.id} m={m} isAdmin={isAdmin} onRole={changeRole} onRemove={remove} onRefresh={() => router.refresh()} />
          ))}
        </div>
        {isAdmin && (
          <p className="text-[11px] text-faint mt-2">
            Roles cover the 90%. The switches under each person are the exceptions — grant a foreman $ visibility,
            or give your bookkeeper Billing without making them an admin.
          </p>
        )}
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
                {inv.email && (
                  <button
                    onClick={async () => {
                      setEmailing(inv.id)
                      try {
                        const r = await emailInviteAction(inv.id)
                        setSentNote(r.ok ? `Invite emailed to ${inv.email}.` : r.error ?? 'Send failed.')
                      } finally { setEmailing(null) }
                    }}
                    disabled={emailing === inv.id}
                    className="inline-flex items-center gap-1 text-xs text-teal hover:underline disabled:opacity-50"
                  >
                    <Mail className="h-3.5 w-3.5" /> {emailing === inv.id ? 'Sending…' : 'Email'}
                  </button>
                )}
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

/** One member: role select + per-person sensitive-info switches (admin view).
 *  Each switch shows the EFFECTIVE state (override ?? role default); tapping
 *  sets an explicit override, and "reset" reverts to the role default. */
function MemberRow({
  m, isAdmin, onRole, onRemove, onRefresh,
}: {
  m: TeamMember
  isAdmin: boolean
  onRole: (id: string, r: Role) => void
  onRemove: (id: string, name: string) => void
  onRefresh: () => void
}) {
  const meta = ROLE_META[m.role]
  const Icon = meta.icon
  const [expanded, setExpanded] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const defaults = ROLE_DEFAULTS[m.role]
  const defaultFor = { can_view_costs: defaults.canViewCosts, can_manage_billing: defaults.canManageBilling, can_manage_team: defaults.canManageTeam }
  const editable = isAdmin && !m.isYou && m.role !== 'admin'

  const setOverride = async (key: typeof OVERRIDES[number]['key'], value: boolean | null) => {
    setBusyKey(key)
    const ok = await updateMemberOverridesAction(m.id, { [key]: value })
    setBusyKey(null)
    if (!ok) alert('Could not save that permission. Is migration 011 applied?')
    onRefresh()
  }

  return (
    <div className="p-3.5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-navy-800 grid place-items-center text-sm font-bold text-muted flex-none">
          {(m.name || m.email || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink truncate">{m.name}{m.isYou && <span className="text-faint font-normal"> · you</span>}</p>
          {m.email && <p className="text-xs text-faint truncate">{m.email}</p>}
        </div>
        {isAdmin && !m.isYou ? (
          <>
            <select value={m.role} onChange={(e) => onRole(m.id, e.target.value as Role)} className="rounded-md bg-navy-950 border border-navy-700 text-xs text-ink px-2 py-1.5">
              {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
            {editable && (
              <button
                onClick={() => setExpanded((v) => !v)}
                title="Per-person permissions"
                className={'grid place-items-center w-7 h-7 rounded-md border transition-colors ' + (expanded ? 'bg-teal/15 text-teal border-teal/40' : 'text-faint border-navy-700 hover:text-ink')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={() => onRemove(m.id, m.name)} className="text-faint hover:text-alert p-1" title="Remove"><Trash2 className="h-4 w-4" /></button>
          </>
        ) : (
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.cls}`}><Icon className="h-3.5 w-3.5" />{meta.label}</span>
        )}
      </div>

      {editable && expanded && (
        <div className="mt-3 ml-12 flex flex-wrap gap-2">
          {OVERRIDES.map(({ key, label, icon: OIcon }) => {
            const override = m[key] ?? null
            const effective = override ?? defaultFor[key]
            const overridden = override !== null
            return (
              <span key={key} className="inline-flex items-center">
                <button
                  disabled={busyKey === key}
                  onClick={() => setOverride(key, !effective)}
                  className={
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-colors disabled:opacity-60 ' +
                    (effective
                      ? 'bg-teal/15 text-teal border-teal/40'
                      : 'bg-navy-950 text-faint border-navy-700 hover:text-muted')
                  }
                  title={overridden ? 'Explicit for this person' : 'From role default'}
                >
                  <OIcon className="h-3 w-3" /> {label}{effective ? '' : ' · off'}
                </button>
                {overridden && (
                  <button
                    onClick={() => setOverride(key, null)}
                    title="Reset to role default"
                    className="ml-1 text-[10px] text-faint hover:text-ink underline decoration-dotted"
                  >reset</button>
                )}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
