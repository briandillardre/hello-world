'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bell, CheckCheck, AlertTriangle, MapPin, Clock, Moon, Siren, ChevronDown } from 'lucide-react'
import type { AlertEvent, AlertRule } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { SortPills } from '@/components/ui/list-controls'

const TRIGGER_LABELS: Record<AlertRule['trigger'], string> = {
  enter: 'Entered zone',
  exit: 'Exited zone',
  idle: 'Idle too long',
  after_hours_movement: 'THEFT ALERT',
  left_site: 'Left job site',
  speeding: 'Speeding',
}

const TRIGGER_COLORS: Record<AlertRule['trigger'], 'default' | 'destructive' | 'secondary'> = {
  enter: 'default',
  exit: 'destructive',
  idle: 'secondary',
  after_hours_movement: 'destructive',
  left_site: 'destructive',
  speeding: 'secondary',
}

const CRITICAL_TRIGGERS: AlertRule['trigger'][] = ['after_hours_movement', 'left_site']
const SNOOZE_KEY = 'ht_alert_snooze'

interface AlertListProps {
  alerts: AlertEvent[]
  onAcknowledge?: (id: string) => void
  /** Ack a specific id set (the "Ack visible" path — theft never rides along). */
  onAcknowledgeMany?: (ids: string[]) => void
}

type SortKey = 'newest' | 'asset' | 'type' | 'zone'

/** One coalesced line inside an asset group: the same trigger in the same
 *  zone repeating every ping is ONE row with a count, not N rows —
 *  "still out of zone" is a status, not a new alert (Aug 22 rebuild). */
interface GroupLine {
  key: string
  label: string
  variant: 'default' | 'destructive' | 'secondary'
  critical: boolean
  zone: string
  count: number
  newest: AlertEvent
  oldestAt: string
  ids: string[]
}

interface AssetGroup {
  assetId: string
  assetName: string
  critical: boolean
  newestAt: string
  lines: GroupLine[]
  unreadIds: string[]
  nonCriticalIds: string[]
}

const isCriticalEvent = (a: AlertEvent) =>
  !a.kind && CRITICAL_TRIGGERS.includes((a.rule?.trigger ?? 'exit') as AlertRule['trigger'])

function readSnoozes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}') as Record<string, string> } catch { return {} }
}

export function AlertList({ alerts, onAcknowledge, onAcknowledgeMany }: AlertListProps) {
  const [sort, setSort] = useState<SortKey>('newest')
  // Alert-fatigue split: routine enter/exit crossings are the ZONE LOG,
  // everything else needs attention. Two tabs, needs-attention first.
  const [tab, setTab] = useState<'alerts' | 'activity'>('alerts')
  // Per-device snooze (v1): hides a machine's NON-critical noise from the
  // triage list until a time — theft is never snoozable. Devices only; the
  // SMS/push pipeline is untouched.
  const [snoozes, setSnoozes] = useState<Record<string, string>>({})
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true); setSnoozes(readSnoozes()) }, [])
  const setSnooze = (assetId: string, untilIso: string | null) => {
    setSnoozes((prev) => {
      const next = { ...prev }
      if (untilIso) next[assetId] = untilIso
      else delete next[assetId]
      try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
      return next
    })
  }
  const snoozedUntil = (assetId: string): Date | null => {
    const raw = snoozes[assetId]
    if (!raw) return null
    const t = new Date(raw)
    return t.getTime() > Date.now() ? t : null
  }

  // Gmail-style: opening this page marks everything as SEEN — the nav badge
  // zeroes out (unacknowledged alerts stay counted here).
  useEffect(() => {
    try {
      localStorage.setItem('ht_alerts_seen_at', new Date().toISOString())
      window.dispatchEvent(new Event('ht:alerts-seen'))
    } catch { /* private mode */ }
  }, [alerts.length])

  const isActivity = (a: AlertEvent) => !a.kind && (a.rule?.trigger === 'enter' || a.rule?.trigger === 'exit')
  const actionable = alerts.filter((a) => !isActivity(a))
  const activity = alerts.filter(isActivity)
  const unreadActionable = actionable.filter((a) => !a.acknowledged_at)

  // ── Needs-attention groups: one card per asset, unread events only,
  //    coalesced per trigger+zone, theft channel pinned first. ──
  const groups = useMemo(() => {
    const byAsset = new Map<string, AssetGroup>()
    for (const a of unreadActionable) {
      let g = byAsset.get(a.asset_id)
      if (!g) {
        byAsset.set(a.asset_id, (g = {
          assetId: a.asset_id,
          assetName: a.asset?.name ?? 'Unknown asset',
          critical: false, newestAt: a.triggered_at, lines: [], unreadIds: [], nonCriticalIds: [],
        }))
      }
      const critical = isCriticalEvent(a)
      g.critical = g.critical || critical
      if (a.triggered_at > g.newestAt) g.newestAt = a.triggered_at
      g.unreadIds.push(a.id)
      if (!critical) g.nonCriticalIds.push(a.id)
      const trigger = (a.rule?.trigger ?? 'exit') as AlertRule['trigger']
      const sysLabel = a.kind === 'fuel_low' ? 'Fuel low' : a.kind === 'battery_low' ? '12V battery weak' : null
      const zone = sysLabel ? 'Vehicle health' : (a.rule?.geofence?.name ?? 'Unknown zone')
      const key = `${a.kind ?? trigger}|${zone}`
      let line = g.lines.find((l) => l.key === key)
      if (!line) {
        g.lines.push((line = {
          key,
          label: sysLabel ?? TRIGGER_LABELS[trigger],
          variant: sysLabel ? 'destructive' : TRIGGER_COLORS[trigger],
          critical, zone, count: 0, newest: a, oldestAt: a.triggered_at, ids: [],
        }))
      }
      line.count++
      line.ids.push(a.id)
      if (a.triggered_at > line.newest.triggered_at) line.newest = a
      if (a.triggered_at < line.oldestAt) line.oldestAt = a.triggered_at
    }
    const arr = Array.from(byAsset.values())
    for (const g of arr) g.lines.sort((x, y) => Number(y.critical) - Number(x.critical) || y.newest.triggered_at.localeCompare(x.newest.triggered_at))
    // Theft channel first, then newest first.
    arr.sort((x, y) => Number(y.critical) - Number(x.critical) || y.newestAt.localeCompare(x.newestAt))
    return arr
  }, [unreadActionable])

  const activeGroups = groups.filter((g) => g.critical || !snoozedUntil(g.assetId))
  const snoozedGroups = groups.filter((g) => !g.critical && snoozedUntil(g.assetId))
  // "Ack visible" — every unread id on screen EXCEPT theft/left-site: those
  // demand a per-row decision, never a bulk sweep (Aug 22 rebuild).
  const ackVisibleIds = activeGroups.flatMap((g) => g.lines.filter((l) => !l.critical).flatMap((l) => l.ids))

  const acked = actionable.filter((a) => a.acknowledged_at)
    .sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))

  // ── Zone log (unchanged flat list with sort + date headers). ──
  const visibleActivity = useMemo(() => {
    const arr = [...activity]
    const name = (a: AlertEvent) => a.asset?.name ?? ''
    const zone = (a: AlertEvent) => a.rule?.geofence?.name ?? ''
    const trig = (a: AlertEvent) => a.rule?.trigger ?? a.kind ?? ''
    if (sort === 'asset') arr.sort((a, b) => name(a).localeCompare(name(b)) || b.triggered_at.localeCompare(a.triggered_at))
    else if (sort === 'zone') arr.sort((a, b) => zone(a).localeCompare(zone(b)) || b.triggered_at.localeCompare(a.triggered_at))
    else if (sort === 'type') arr.sort((a, b) => trig(a).localeCompare(trig(b)) || b.triggered_at.localeCompare(a.triggered_at))
    else arr.sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))
    return arr
  }, [activity, sort])

  const nextMorning = () => {
    const d = new Date()
    if (d.getHours() >= 6) d.setDate(d.getDate() + 1)
    d.setHours(6, 0, 0, 0)
    return d.toISOString()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Alerts</h1>
          {/* ONE number, everywhere: unread actionable — the same count the
              nav bell uses. Zone log is a log, not an alert (Aug 22). */}
          {unreadActionable.length > 0 && (
            <span className="bg-alert text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
              {unreadActionable.length}
            </span>
          )}
          {tab === 'alerts' && ackVisibleIds.length > 1 && onAcknowledgeMany && (
            <button
              onClick={() => onAcknowledgeMany(ackVisibleIds)}
              className="ml-auto px-3 py-1 rounded-full text-xs font-medium border border-navy-700 text-faint hover:text-ink transition-colors whitespace-nowrap"
              title="Acknowledges everything on screen except theft and left-site — those need a per-row decision"
            >
              ✓ Ack visible ({ackVisibleIds.length})
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800 w-fit">
          <button
            onClick={() => setTab('alerts')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${tab === 'alerts' ? 'bg-alert/20 text-alert' : 'text-faint hover:text-ink'}`}
          >
            Needs attention{unreadActionable.length > 0 ? ` (${unreadActionable.length})` : ''}
          </button>
          <button
            onClick={() => setTab('activity')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${tab === 'activity' ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink'}`}
          >
            Zone log ({activity.length})
          </button>
        </div>
        {tab === 'activity' && (
          <SortPills<SortKey>
            options={[['newest', 'Newest'], ['asset', 'By asset'], ['type', 'By type'], ['zone', 'By zone']]}
            value={sort}
            onChange={setSort}
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'alerts' ? (
          <div className="p-3 space-y-3">
            {activeGroups.length === 0 && snoozedGroups.length === 0 && (
              <div className="p-8 max-w-sm mx-auto text-center">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-[#34d399]/10 border border-[#34d399]/25 grid place-items-center mb-3">
                  <Bell className="h-6 w-6 text-[#34d399]" />
                </div>
                <p className="text-ink font-display font-bold">All clear. That&rsquo;s the goal.</p>
                <p className="text-sm text-faint mt-1.5 leading-relaxed">
                  The second a machine moves after hours or leaves a job-site zone, it lands here —
                  and texts your phone if SMS is set up.
                </p>
                <a href="/map" className="inline-block mt-4 text-sm font-semibold text-amber hover:underline">
                  Draw a zone to guard →
                </a>
              </div>
            )}
            {activeGroups.map((g) => (
              <GroupCard
                key={g.assetId}
                group={g}
                onAcknowledge={onAcknowledge}
                onAcknowledgeMany={onAcknowledgeMany}
                onSnooze={g.critical ? undefined : () => setSnooze(g.assetId, nextMorning())}
              />
            ))}
            {snoozedGroups.length > 0 && mounted && (
              <details className="rounded-xl border border-navy-800 bg-navy-950">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-faint flex items-center gap-2">
                  <Moon className="h-3.5 w-3.5" /> Snoozed ({snoozedGroups.length}) — back at 6 AM
                  <ChevronDown className="h-3 w-3 ml-auto" />
                </summary>
                <div className="p-3 pt-0 space-y-3">
                  {snoozedGroups.map((g) => (
                    <div key={g.assetId} className="flex items-center justify-between rounded-lg border border-navy-800 px-3 py-2">
                      <span className="text-sm text-muted truncate">{g.assetName} · {g.unreadIds.length} pending</span>
                      <button onClick={() => setSnooze(g.assetId, null)} className="text-xs text-teal hover:underline flex-none">Wake now</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {acked.length > 0 && (
              <details className="rounded-xl border border-navy-800 bg-navy-950">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-faint flex items-center gap-2">
                  <CheckCheck className="h-3.5 w-3.5" /> Acknowledged ({acked.length})
                  <ChevronDown className="h-3 w-3 ml-auto" />
                </summary>
                <div className="divide-y divide-navy-800">
                  {acked.slice(0, 60).map((alert) => <AlertRow key={alert.id} alert={alert} />)}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="divide-y divide-navy-800">
            {visibleActivity.length === 0 ? (
              <p className="p-8 text-center text-sm text-faint">No zone crossings recorded yet.</p>
            ) : (
              visibleActivity.map((alert, i) => {
                const showHeader = sort === 'newest' && mounted &&
                  (i === 0 || dateGroup(visibleActivity[i - 1].triggered_at) !== dateGroup(alert.triggered_at))
                return (
                  <Fragment key={alert.id}>
                    {showHeader && (
                      <div className="sticky top-0 z-[5] px-4 py-1.5 text-[10px] font-mono uppercase tracking-[0.1em] text-faint bg-navy-950/95 backdrop-blur">
                        {dateGroup(alert.triggered_at)}
                      </div>
                    )}
                    <AlertRow alert={alert} onAcknowledge={onAcknowledge} />
                  </Fragment>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** One asset's card: name up top, every open issue as a coalesced line.
 *  Theft-bearing cards wear the red treatment and refuse snooze. */
function GroupCard({ group: g, onAcknowledge, onAcknowledgeMany, onSnooze }: {
  group: AssetGroup
  onAcknowledge?: (id: string) => void
  onAcknowledgeMany?: (ids: string[]) => void
  onSnooze?: () => void
}) {
  return (
    <div className={`rounded-xl border overflow-hidden ${g.critical ? 'border-alert/50 bg-alert/[0.07]' : 'border-navy-800 bg-navy-950'}`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${g.critical ? 'border-alert/30' : 'border-navy-800'}`}>
        {g.critical && <Siren className="h-4 w-4 text-alert flex-none animate-blink" />}
        <Link href={`/assets/${g.assetId}`} className="font-semibold text-sm text-ink hover:text-amber truncate">
          {g.assetName}
        </Link>
        <span className="ml-auto flex items-center gap-2 flex-none">
          {onSnooze && (
            <button onClick={onSnooze} className="p-1.5 text-faint hover:text-ink rounded-lg" title="Snooze this machine until 6 AM (theft is never snoozed)">
              <Moon className="h-4 w-4" />
            </button>
          )}
          {onAcknowledgeMany && g.nonCriticalIds.length > 0 && !g.critical && (
            <button
              onClick={() => onAcknowledgeMany(g.unreadIds)}
              className="p-1.5 text-faint hover:text-[#34d399] hover:bg-[#34d399]/15 rounded-lg"
              title="Acknowledge everything on this asset"
            >
              <CheckCheck className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>
      <div className="divide-y divide-navy-800/60">
        {g.lines.map((l) => (
          <div key={l.key} className="flex items-start gap-3 px-4 py-2.5">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-none mt-0.5 ${l.critical ? 'bg-alert/15' : 'bg-amber/15'}`}>
              {l.key.startsWith('idle')
                ? <Clock className="h-3.5 w-3.5 text-amber" />
                : <AlertTriangle className={`h-3.5 w-3.5 ${l.critical ? 'text-alert' : 'text-amber'}`} />}
            </div>
            <Link href={replayHref(l.newest)} className="flex-1 min-w-0 group" title="View this moment on the map">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={l.variant}>{l.label}</Badge>
                {l.count > 1 && <span className="font-mono text-[10.5px] text-faint">×{l.count}</span>}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
                <MapPin className="h-3 w-3" /> {l.zone}
              </div>
              <p className="text-xs text-faint mt-0.5" suppressHydrationWarning>
                {l.count > 1
                  ? `latest ${formatRelativeTime(l.newest.triggered_at)} · since ${formatRelativeTime(l.oldestAt)}`
                  : formatRelativeTime(l.newest.triggered_at)}
                <span className="ml-2 text-teal opacity-0 group-hover:opacity-100 transition-opacity">view on map →</span>
              </p>
            </Link>
            {onAcknowledge && (
              <button
                onClick={() => l.ids.forEach((id) => onAcknowledge(id))}
                className="flex-none p-1.5 text-faint hover:text-[#34d399] hover:bg-[#34d399]/15 rounded-lg transition-colors"
                title={l.count > 1 ? `Acknowledge all ${l.count}` : 'Acknowledge'}
              >
                <CheckCheck className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Local-calendar bucket for the newest-first list. Client component, so plain
 *  Date math runs in the viewer's own timezone. */
function dateGroup(iso: string): 'Today' | 'Yesterday' | 'This week' | 'Earlier' {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  return 'Earlier'
}

/** Deep link to the map replay: a 3-hour window with the scrubber parked on
 *  the moment the alert fired, camera pinned to the asset involved. */
function replayHref(alert: AlertEvent): string {
  const at = Date.parse(alert.triggered_at)
  const from = at - 2 * 3_600_000
  const to = at + 3_600_000
  return `/map?range=custom&from=${from}&to=${to}&t=${(2 / 3).toFixed(4)}&follow=${alert.asset_id}`
}

function AlertRow({ alert, onAcknowledge }: { alert: AlertEvent; onAcknowledge?: (id: string) => void }) {
  const trigger = alert.rule?.trigger ?? 'exit'
  // System (vehicle-health) alerts carry `kind` and no rule/zone.
  const sysLabel = alert.kind === 'fuel_low' ? 'Fuel low'
    : alert.kind === 'battery_low' ? '12V battery weak' : null
  const isUnread = !alert.acknowledged_at
  const isCritical = CRITICAL_TRIGGERS.includes(trigger) && !sysLabel
  const assetName = alert.asset?.name ?? 'Unknown Asset'
  const zoneName = sysLabel ? 'Vehicle health' : (alert.rule?.geofence?.name ?? 'Unknown Zone')

  const rowBg = isCritical && isUnread
    ? 'bg-alert/15 border-l-4 border-alert'
    : isUnread ? 'bg-amber/15' : 'hover:bg-navy-800'

  return (
    <div className={`flex items-start gap-3 p-4 transition-colors ${rowBg}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
        isCritical && isUnread ? 'bg-alert/15' : isUnread ? 'bg-amber/15' : 'bg-navy-800'
      }`}>
        {trigger === 'idle'
          ? <Clock className={`h-4 w-4 ${isUnread ? 'text-amber' : 'text-faint'}`} />
          : <AlertTriangle className={`h-4 w-4 ${isCritical && isUnread ? 'text-alert' : isUnread ? 'text-amber' : 'text-faint'}`} />
        }
      </div>

      <Link href={replayHref(alert)} className="flex-1 min-w-0 group" title="View this moment on the map">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-ink group-hover:text-amber transition-colors">{assetName}</span>
          <Badge variant={sysLabel ? 'destructive' : TRIGGER_COLORS[trigger]}>{sysLabel ?? TRIGGER_LABELS[trigger]}</Badge>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
          <MapPin className="h-3 w-3" />
          {zoneName}
        </div>
        {/* suppressHydrationWarning: "Xm ago" drifts between server render and
            client hydration — cosmetic, not worth a mismatch error. */}
        <p className="text-xs text-faint mt-0.5" suppressHydrationWarning>
          {formatRelativeTime(alert.triggered_at)}
          <span className="ml-2 text-teal opacity-0 group-hover:opacity-100 transition-opacity">view on map →</span>
        </p>
      </Link>

      {/* secondary link — the whole row deep-links to the map replay, this
          jumps to the asset's own page instead (can't nest inside the Link) */}
      <Link
        href={`/assets/${alert.asset_id}`}
        className="flex-shrink-0 text-[11px] text-faint hover:text-teal hover:underline mt-1"
        title={`Open ${assetName}`}
      >
        asset →
      </Link>

      {isUnread && onAcknowledge && (
        <button
          onClick={() => onAcknowledge(alert.id)}
          className="flex-shrink-0 p-1.5 text-faint hover:text-[#34d399] hover:bg-[#34d399]/15 rounded-lg transition-colors"
          title="Mark as read"
        >
          <CheckCheck className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
