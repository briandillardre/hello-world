'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Radio, Inbox, Trash2, Undo2, ArrowRight, Cpu, MapPin } from 'lucide-react'
import { RETENTION_DAYS, type TrackersOverview, type TrackerRow, type MoveRow } from '@/lib/trackers-types'
import { MODELS } from '@/lib/devices'
import { undoTrackerMoveAction, restoreAssetAction } from '@/lib/actions/trackers'
import { toast, confirmSheet } from '@/components/ui/feedback'
import { formatRelativeTime } from '@/lib/utils'

const TYPE_EMOJI: Record<string, string> = { vehicle: '🚛', equipment: '🏗️', personnel: '👷', tool: '🔧' }
const short = (imei: string) => `…${imei.slice(-4)}`
const modelName = (m: TrackerRow['model']) => (m ? MODELS[m].name : 'Tracker')

function seenTone(iso: string | null): string {
  if (!iso) return 'text-faint'
  const age = Date.now() - Date.parse(iso)
  return age < 2 * 3_600_000 ? 'text-[#34d399]' : age < 48 * 3_600_000 ? 'text-amber' : 'text-faint'
}

/**
 * /trackers — every box the company owns, in one of two places: on a
 * machine, or in the drawer. Plus the two safety nets (092): recently
 * deleted assets, and the last 30 days of tracker changes with Undo.
 */
export function TrackersPage({ data, canEdit }: { data: TrackersOverview; canEdit: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)

  const undo = (m: MoveRow) => {
    start(async () => {
      const ok = await confirmSheet({
        title: 'Undo this change?',
        message: `${describe(m)} Pings go back where they were and the tracker returns to its previous machine.`,
        confirmLabel: 'Undo',
      })
      if (!ok) return
      setBusyId(m.id)
      const res = await undoTrackerMoveAction(m.id)
      setBusyId(null)
      if (!res.ok) { toast(res.error ?? 'Could not undo.', { variant: 'error' }); return }
      toast('Undone', { variant: 'success' })
      router.refresh()
    })
  }

  const restore = (id: string, name: string) => {
    start(async () => {
      setBusyId(id)
      const res = await restoreAssetAction(id)
      setBusyId(null)
      if (!res.ok) { toast(res.error ?? 'Could not restore.', { variant: 'error' }); return }
      toast(res.trackerReleased ? `"${name}" is back — without its tracker, which is now on another machine.` : `"${name}" is back.`, { variant: 'success' })
      router.refresh()
    })
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-ink flex items-center gap-2"><Radio className="h-5 w-5 text-amber" /> Trackers</h1>
        <p className="text-[13px] text-muted mt-1 leading-snug">
          Every box you own is either on a machine or in the drawer. Change which from the machine&apos;s page (Tracker button).
          Mistakes can be undone for {RETENTION_DAYS} days.
        </p>
      </div>

      {/* ── The drawer ── */}
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-2">
          <Inbox className="h-3.5 w-3.5" /> Unassigned · {data.unassigned.length}
        </h2>
        {data.unassigned.length === 0 ? (
          <p className="text-[13px] text-faint rounded-xl border border-dashed border-navy-700 p-4">
            Nothing in the drawer. A tracker lands here when you take it out of a machine, delete a machine, or log a new box on <Link href="/assets/onboard" className="text-teal underline">Hardware setup</Link> before it has a home.
          </p>
        ) : (
          <ul className="rounded-xl border border-navy-800 divide-y divide-navy-800 overflow-hidden">
            {data.unassigned.map((t) => (
              <li key={t.imei} className="px-3 py-2.5 flex items-center gap-3 bg-navy-900">
                <Cpu className="h-4 w-4 text-faint flex-none" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-ink truncate">
                    {modelName(t.model)} <span className="font-mono text-muted">{short(t.imei)}</span>
                    {t.label && <span className="text-faint font-normal"> · {t.label}</span>}
                  </p>
                  <p className="text-[11.5px] leading-snug">
                    <span className={seenTone(t.lastSeen?.timestamp ?? null)}>
                      {t.lastSeen ? `reporting · last ${formatRelativeTime(t.lastSeen.timestamp)}` : 'silent'}
                    </span>
                    {t.buffered > 0 && <span className="text-faint"> · {t.buffered.toLocaleString()} pings waiting</span>}
                    {t.unassignedSince && <span className="text-faint"> · pulled {formatRelativeTime(t.unassignedSince)}</span>}
                  </p>
                </div>
                {t.lastSeen?.lat != null && t.lastSeen.lng != null && (
                  <a href={`https://www.google.com/maps?q=${t.lastSeen.lat},${t.lastSeen.lng}`} target="_blank" rel="noreferrer" title="Where it last reported from" className="grid place-items-center w-8 h-8 rounded-lg border border-navy-700 text-teal">
                    <MapPin className="h-4 w-4" />
                  </a>
                )}
                <span className="font-mono text-[11px] text-faint hidden sm:inline">{t.imei}</span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && data.unassigned.length > 0 && (
          <p className="text-[12px] text-faint">To put one on a machine: open that machine under <Link href="/assets" className="text-teal underline">Assets</Link> → <span className="text-ink">Add tracker</span>.</p>
        )}
      </section>

      {/* ── Installed ── */}
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-2">
          <Radio className="h-3.5 w-3.5" /> On a machine · {data.installed.length}
        </h2>
        {data.installed.length === 0 ? (
          <p className="text-[13px] text-faint rounded-xl border border-dashed border-navy-700 p-4">No machine has a tracker yet.</p>
        ) : (
          <ul className="rounded-xl border border-navy-800 divide-y divide-navy-800 overflow-hidden">
            {data.installed.map((t) => (
              <li key={t.imei} className="bg-navy-900">
                <Link href={`/assets/${t.asset!.id}`} className="px-3 py-2.5 flex items-center gap-3 hover:bg-navy-800 transition-colors">
                  <span className="text-lg flex-none">{TYPE_EMOJI[t.asset!.type] ?? '📦'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink truncate">{t.asset!.name}</p>
                    <p className="text-[11.5px] leading-snug">
                      <span className="text-muted">{modelName(t.model)} <span className="font-mono">{short(t.imei)}</span></span>
                      <span className={'ml-1.5 ' + seenTone(t.lastSeen?.timestamp ?? null)}>
                        {t.lastSeen ? `· last ${formatRelativeTime(t.lastSeen.timestamp)}` : '· never reported'}
                      </span>
                      {!t.registered && <span className="text-faint"> · not on Hardware setup</span>}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-faint flex-none" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Recently deleted ── */}
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-2">
          <Trash2 className="h-3.5 w-3.5" /> Recently deleted · {data.deletedAssets.length}
        </h2>
        {data.deletedAssets.length === 0 ? (
          <p className="text-[13px] text-faint rounded-xl border border-dashed border-navy-700 p-4">Nothing deleted in the last {RETENTION_DAYS} days.</p>
        ) : (
          <ul className="rounded-xl border border-navy-800 divide-y divide-navy-800 overflow-hidden">
            {data.deletedAssets.map((a) => {
              const daysLeft = Math.max(0, Math.ceil((Date.parse(a.purge_at) - Date.now()) / 86_400_000))
              return (
                <li key={a.id} className="px-3 py-2.5 flex items-center gap-3 bg-navy-900">
                  <span className="text-lg flex-none opacity-60">{TYPE_EMOJI[a.type] ?? '📦'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink truncate">{a.name}</p>
                    <p className="text-[11.5px] text-faint leading-snug">
                      deleted {formatRelativeTime(a.deleted_at)}{a.tracker_id ? ` · had tracker ${short(a.tracker_id)}` : ''} · <span className={daysLeft <= 5 ? 'text-alert' : ''}>gone for good in {daysLeft} day{daysLeft === 1 ? '' : 's'}</span>
                    </p>
                  </div>
                  {canEdit && (
                    <button onClick={() => restore(a.id, a.name)} disabled={pending && busyId === a.id} className="inline-flex items-center gap-1 rounded-lg border border-teal/50 text-teal text-[12px] font-semibold px-2.5 py-1.5 hover:bg-teal/10 disabled:opacity-50">
                      <Undo2 className="h-3.5 w-3.5" /> Restore
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ── Change log ── */}
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint flex items-center gap-2">
          <Undo2 className="h-3.5 w-3.5" /> Recent changes
        </h2>
        {data.moves.length === 0 ? (
          <p className="text-[13px] text-faint rounded-xl border border-dashed border-navy-700 p-4">No tracker changes yet.</p>
        ) : (
          <ul className="rounded-xl border border-navy-800 divide-y divide-navy-800 overflow-hidden">
            {data.moves.map((m) => (
              <li key={m.id} className={'px-3 py-2.5 flex items-center gap-3 bg-navy-900 ' + (m.undone_at ? 'opacity-50' : '')}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink leading-snug">{describe(m)}</p>
                  <p className="text-[11.5px] text-faint">
                    {formatRelativeTime(m.created_at)}
                    {m.moved_locations > 0 && ` · ${m.moved_locations.toLocaleString()} pings moved`}
                    {m.moved_buffered > 0 && ` · ${m.moved_buffered.toLocaleString()} drawer pings landed`}
                    {m.undone_at && ' · undone'}
                  </p>
                </div>
                {canEdit && m.undoable && (
                  <button onClick={() => undo(m)} disabled={pending && busyId === m.id} className="inline-flex items-center gap-1 rounded-lg border border-navy-700 text-ink text-[12px] font-semibold px-2.5 py-1.5 hover:bg-navy-800 disabled:opacity-50">
                    <Undo2 className="h-3.5 w-3.5" /> Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11.5px] text-faint">
        Bluetooth tool tags live on <Link href="/tags" className="text-teal underline">Tag scanner</Link>; SIM and config steps for a new box on <Link href="/assets/onboard" className="text-teal underline">Hardware setup</Link>.
      </p>
    </div>
  )
}

function describe(m: MoveRow): string {
  const t = `Tracker ${short(m.tracker_id)}`
  const at = new Date(m.swap_at).toLocaleString()
  const from = m.from_asset?.name ?? 'a deleted machine'
  const to = m.to_asset?.name ?? 'a deleted machine'
  switch (m.kind) {
    case 'attach': return `${t} put on "${to}" as of ${at}.`
    case 'detach': return `${t} taken off "${from}" as of ${at}, into the drawer.`
    case 'move': return `${t} moved from "${from}" to "${to}" as of ${at}.`
    case 'split_history': return `"${from}" kept ${t}; its history before ${at} split off to "${to}".`
  }
}
