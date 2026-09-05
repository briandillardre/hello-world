'use client'
import { busy as trackBusy } from '@/lib/busy'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, Copy, Check, Trash2, Shield, HardHat, Eye, Briefcase, SlidersHorizontal, DollarSign, Receipt, Users, Mail, Crown, Sparkles, RotateCcw } from 'lucide-react'
import type { TeamData, Role, TeamMember } from '@/lib/db/team'
import { createInviteAction, emailInviteAction, revokeInviteAction, updateMemberRoleAction, removeMemberAction, updateMemberOverridesAction, updateRolePolicyAction } from '@/lib/actions/team'
import { viewAsAction } from '@/lib/actions/viewas'
import { ROLE_DEFAULTS, ROLE_LABEL, ROLE_BLURB, FEATURES, ROLE_FEATURE_DEFAULTS, featuresForRole, type FeatureKey, type RolePolicy } from '@/lib/permissions'
import { formatRelativeTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast, confirmSheet } from '@/components/ui/feedback'

const ROLE_META: Record<Role, { icon: typeof Shield; cls: string }> = {
  admin:     { icon: Shield,    cls: 'text-amber' },
  manager:   { icon: Briefcase, cls: 'text-[#60a5fa]' },
  foreman:   { icon: HardHat,   cls: 'text-teal' },
  associate: { icon: Eye,       cls: 'text-muted' },
}

// The three sensitive-info toggles an admin can override per person.
const OVERRIDES = [
  { key: 'can_view_costs' as const,     label: 'See $ costs',   icon: DollarSign },
  { key: 'can_manage_billing' as const, label: 'Billing & QBO', icon: Receipt },
  { key: 'can_manage_team' as const,    label: 'Manage team',   icon: Users },
]

export function TeamManager({ data }: { data: TeamData }) {
  const router = useRouter()
  const { members, invites, isAdmin, isMaster, assignableRoles, editableRoles, policy } = data
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('associate')
  const [busy, setBusy] = useState(false)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sentNote, setSentNote] = useState<string | null>(null)
  const [emailing, setEmailing] = useState<string | null>(null)

  const linkFor = (token: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/join?token=${token}`

  const invite = async () => {
    setBusy(true); setErr(null); setNewLink(null)
    const doneBar = trackBusy('Sending invite…')
    try {
      const to = email.trim()
      const res = await createInviteAction(email, role)
      if ('error' in res) { setErr(res.error); return }
      setNewLink(linkFor(res.token))
      if (res.emailed) setSentNote(`Invite emailed to ${to} — link below if you want to text it too.`)
      else if (res.emailError === 'not configured' && to) setSentNote('Email sending isn’t set up yet (RESEND_API_KEY) — copy the link below and send it yourself.')
      else if (res.emailError && to) setSentNote(`Couldn’t email the invite (${res.emailError}) — copy the link below instead.`)
      else setSentNote(null)
      setEmail('')
      router.refresh()
    } catch {
      setErr('Something went wrong.')
    } finally { setBusy(false); doneBar() }
  }

  const copy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1600) } catch { /* clipboard blocked */ }
  }

  const changeRole = async (id: string, r: Role) => {
    const ok = await updateMemberRoleAction(id, r)
    if (!ok) toast('Couldn’t change that role — you can only set levels below your own.', { variant: 'error' })
    router.refresh()
  }
  const remove = async (id: string, name: string) => {
    if (await confirmSheet({ title: `Remove ${name} from the team?`, confirmLabel: 'Remove', destructive: true })) {
      await removeMemberAction(id)
      router.refresh()
    }
  }
  const revoke = async (id: string) => { await revokeInviteAction(id); router.refresh() }

  return (
    <div className="space-y-6">
      {/* Invite */}
      {isAdmin && assignableRoles.length > 0 && (
        <section className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-ink flex items-center gap-2"><UserPlus className="h-4 w-4 text-amber" /> Invite a teammate</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input placeholder="name@company.com (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1" />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-lg bg-navy-950 border border-navy-700 text-ink text-sm px-3 py-2">
              {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <Button onClick={invite} disabled={busy}>{busy ? 'Creating…' : 'Create invite'}</Button>
          </div>
          <p className="text-[11px] text-faint">{ROLE_BLURB[role]}. With an email, the invite sends itself; leave it blank for a share link.</p>
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
            <MemberRow key={m.id} m={m} isMaster={isMaster} assignableRoles={assignableRoles} onRole={changeRole} onRemove={remove} onRefresh={() => router.refresh()} />
          ))}
        </div>
        {isAdmin && (
          <p className="text-[11px] text-faint mt-2">
            Roles cover the 90%. The switches under each person are the exceptions — grant a foreman $ visibility,
            or give your bookkeeper Billing without making them an admin. <span className="text-ink">View as</span> shows you the app exactly as they see it.
          </p>
        )}
      </section>

      {/* View levels */}
      {editableRoles.length > 0 && <ViewLevels policy={policy} editableRoles={editableRoles} isMaster={isMaster} />}

      {/* Pending invites */}
      {invites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-faint uppercase tracking-wider mb-2">Pending invites ({invites.length})</h2>
          <div className="rounded-xl border border-navy-800 bg-navy-900 divide-y divide-navy-800">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{inv.email || 'Anyone with the link'}</p>
                  <p className="text-xs text-faint">
                    {ROLE_LABEL[inv.role]}
                    {(() => {
                      const created = (inv as typeof inv & { created_at?: string }).created_at
                      return created ? <> · created {formatRelativeTime(created)}</> : null
                    })()}
                    {Date.parse(inv.expires_at) < Date.now()
                      ? <> · <span className="text-red-400 font-semibold">expired {new Date(inv.expires_at).toLocaleDateString()}</span> — resend to issue a fresh link</>
                      : <> · expires {new Date(inv.expires_at).toLocaleDateString()}</>}
                  </p>
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
                    <Mail className="h-3.5 w-3.5" /> {emailing === inv.id ? 'Sending…' : 'Resend email'}
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

/** One member: role select + per-person switches + View as + AI chats (for
 *  people the caller outranks). The Master shows as a plain Admin to
 *  everyone except themselves. */
function MemberRow({
  m, isMaster, assignableRoles, onRole, onRemove, onRefresh,
}: {
  m: TeamMember
  isMaster: boolean
  assignableRoles: Role[]
  onRole: (id: string, r: Role) => void
  onRemove: (id: string, name: string) => void
  onRefresh: () => void
}) {
  const router = useRouter()
  const meta = ROLE_META[m.role]
  const Icon = meta.icon
  const [expanded, setExpanded] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const defaults = ROLE_DEFAULTS[m.role]
  const defaultFor = { can_view_costs: defaults.canViewCosts, can_manage_billing: defaults.canManageBilling, can_manage_team: defaults.canManageTeam }
  const switchable = m.manageable && m.role !== 'admin'

  const setOverride = async (key: typeof OVERRIDES[number]['key'], value: boolean | null) => {
    setBusyKey(key)
    const ok = await updateMemberOverridesAction(m.id, { [key]: value })
    setBusyKey(null)
    if (!ok) toast('Could not save that permission.', { variant: 'error' })
    onRefresh()
  }

  const viewAs = () => start(async () => {
    const res = await viewAsAction(m.id)
    if (!res.ok) { toast(res.error ?? 'Could not start the preview.', { variant: 'error' }); return }
    router.push('/map'); router.refresh()
  })

  return (
    <div className="p-3.5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-navy-800 grid place-items-center text-sm font-bold text-muted flex-none">
          {(m.name || m.email || '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink truncate">
            {m.name}{m.isYou && <span className="text-faint font-normal"> · you</span>}
            {m.isMaster && isMaster && <span title="Master admin — the owner login" className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] font-bold text-amber align-middle"><Crown className="h-3 w-3" /> owner</span>}
          </p>
          {m.email && <p className="text-xs text-faint truncate">{m.email}</p>}
        </div>
        {m.manageable ? (
          <>
            <select value={m.role} onChange={(e) => onRole(m.id, e.target.value as Role)} className="rounded-md bg-navy-950 border border-navy-700 text-xs text-ink px-2 py-1.5">
              {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button
              onClick={() => setExpanded((v) => !v)}
              title="More for this person"
              className={'grid place-items-center w-8 h-8 rounded-md border transition-colors ' + (expanded ? 'bg-teal/15 text-teal border-teal/40' : 'text-faint border-navy-700 hover:text-ink')}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onRemove(m.id, m.name)} className="text-faint hover:text-alert p-1" title="Remove"><Trash2 className="h-4 w-4" /></button>
          </>
        ) : (
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.cls}`}><Icon className="h-3.5 w-3.5" />{ROLE_LABEL[m.role]}</span>
        )}
      </div>

      {m.manageable && expanded && (
        <div className="mt-3 ml-12 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button onClick={viewAs} disabled={pending} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold border border-amber/50 bg-amber/10 text-amber hover:bg-amber/20 disabled:opacity-60">
              <Eye className="h-3 w-3" /> View app as {m.name.split(' ')[0]}
            </button>
            <Link href={`/team/${m.id}/ai`} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold border border-navy-700 text-ink hover:bg-navy-800">
              <Sparkles className="h-3 w-3 text-amber" /> AI conversations
            </Link>
          </div>
          {switchable && (
            <div className="flex flex-wrap gap-2">
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
                        (effective ? 'bg-teal/15 text-teal border-teal/40' : 'bg-navy-950 text-faint border-navy-700 hover:text-muted')
                      }
                      title={overridden ? 'Explicit for this person' : 'From role default'}
                    >
                      <OIcon className="h-3 w-3" /> {label}{effective ? '' : ' · off'}
                    </button>
                    {overridden && (
                      <button onClick={() => setOverride(key, null)} title="Reset to role default" className="ml-1 text-[10px] text-faint hover:text-ink underline decoration-dotted">reset</button>
                    )}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The view-levels table (Brian, Sep 4): per role, which pages and abilities
 * are on. The Master edits every column incl. Admin; Admins edit the roles
 * below them. A dot marks a cell changed from the default; ↺ puts it back.
 */
function ViewLevels({ policy, editableRoles, isMaster }: { policy: RolePolicy; editableRoles: Role[]; isMaster: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const groups = ['Watch', 'Field', 'Office', 'Setup', 'Abilities'] as const

  const flip = async (role: Role, key: FeatureKey, value: boolean | null) => {
    const id = `${role}:${key}`
    setBusy(id)
    const res = await updateRolePolicyAction(role, key, value)
    setBusy(null)
    if (!res.ok) { toast(res.error ?? 'Could not save.', { variant: 'error' }); return }
    router.refresh()
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-faint uppercase tracking-wider">View levels</h2>
      <p className="text-[12px] text-muted leading-snug">
        What each role can open and do. {isMaster ? 'You set every column, Admin included.' : 'You set the roles below yours.'} Changes apply to everyone with that role right away.
      </p>
      <div className="rounded-xl border border-navy-800 bg-navy-900 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-navy-800">
              <th className="text-left font-mono text-[10px] uppercase tracking-wide text-faint px-3 py-2">Feature</th>
              {editableRoles.map((r) => <th key={r} className="font-semibold text-ink px-2 py-2 text-center whitespace-nowrap">{ROLE_LABEL[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g} group={g} editableRoles={editableRoles} policy={policy} busy={busy} onFlip={flip} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-faint">Defaults: Manager sees job costs and receipts but not the books; Foreman sees no dollar figures; Associate gets the map, clock, logs, maintenance and tags.</p>
    </section>
  )
}

function GroupRows({ group, editableRoles, policy, busy, onFlip }: {
  group: string; editableRoles: Role[]; policy: RolePolicy; busy: string | null
  onFlip: (role: Role, key: FeatureKey, value: boolean | null) => void
}) {
  const rows = FEATURES.filter((f) => f.group === group)
  return (
    <>
      <tr><td colSpan={1 + editableRoles.length} className="px-3 pt-2.5 pb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{group}</td></tr>
      {rows.map((f) => (
        <tr key={f.key} className="border-t border-navy-800/60">
          <td className="px-3 py-1.5">
            <span className="text-ink">{f.label}</span>
            <span className="block text-[10.5px] text-faint leading-tight">{f.hint}</span>
          </td>
          {editableRoles.map((r) => {
            const eff = featuresForRole(r, policy)[f.key]
            const def = ROLE_FEATURE_DEFAULTS[r][f.key]
            const changed = typeof policy[r]?.[f.key] === 'boolean'
            const id = `${r}:${f.key}`
            return (
              <td key={r} className="px-2 py-1.5 text-center">
                <span className="inline-flex items-center gap-1">
                  <button
                    disabled={busy === id}
                    onClick={() => onFlip(r, f.key, !eff)}
                    title={changed ? `Changed from the default (${def ? 'on' : 'off'})` : 'Default'}
                    className={'relative inline-flex h-7 w-12 items-center rounded-full border transition-colors disabled:opacity-60 ' + (eff ? 'bg-teal/25 border-teal/50' : 'bg-navy-950 border-navy-700')}
                  >
                    <span className={'absolute h-5 w-5 rounded-full transition-transform ' + (eff ? 'translate-x-6 bg-teal' : 'translate-x-1 bg-navy-600')} />
                    {changed && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber" />}
                  </button>
                  {changed && (
                    <button onClick={() => onFlip(r, f.key, null)} title="Back to default" className="text-faint hover:text-ink"><RotateCcw className="h-3 w-3" /></button>
                  )}
                </span>
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
