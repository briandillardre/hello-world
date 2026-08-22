'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bell, CheckCheck, AlertTriangle, MapPin, Clock } from 'lucide-react'
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

interface AlertListProps {
  alerts: AlertEvent[]
  onAcknowledge?: (id: string) => void
  onAcknowledgeAll?: () => void
}

type SortKey = 'newest' | 'asset' | 'type' | 'zone'

export function AlertList({ alerts, onAcknowledge, onAcknowledgeAll }: AlertListProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  // Alert-fatigue split: routine enter/exit crossings are the ZONE LOG,
  // everything else needs attention. Two tabs, needs-attention first.
  const [tab, setTab] = useState<'alerts' | 'activity'>('alerts')
  // Date separators render only after mount — the server's timezone can bucket
  // a row differently than the viewer's, and that's a hydration mismatch.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Gmail-style: opening this page marks everything as SEEN — the nav badge
  // zeroes out (unacknowledged alerts stay in the Unread filter here).
  useEffect(() => {
    try {
      localStorage.setItem('ht_alerts_seen_at', new Date().toISOString())
      window.dispatchEvent(new Event('ht:alerts-seen'))
    } catch { /* private mode */ }
  }, [alerts.length])

  const isActivity = (a: AlertEvent) => !a.kind && (a.rule?.trigger === 'enter' || a.rule?.trigger === 'exit')
  const tabbed = alerts.filter(a => (tab === 'activity' ? isActivity(a) : !isActivity(a)))
  const activityCount = alerts.filter(isActivity).length
  const unreadCount = tabbed.filter(a => !a.acknowledged_at).length
  const filtered = filter === 'unread' ? tabbed.filter(a => !a.acknowledged_at) : tabbed
  const visible = useMemo(() => {
    const arr = [...filtered]
    const name = (a: AlertEvent) => a.asset?.name ?? ''
    const zone = (a: AlertEvent) => a.rule?.geofence?.name ?? ''
    const trig = (a: AlertEvent) => a.rule?.trigger ?? a.kind ?? ''
    if (sort === 'asset') arr.sort((a, b) => name(a).localeCompare(name(b)) || b.triggered_at.localeCompare(a.triggered_at))
    else if (sort === 'zone') arr.sort((a, b) => zone(a).localeCompare(zone(b)) || b.triggered_at.localeCompare(a.triggered_at))
    else if (sort === 'type') arr.sort((a, b) => trig(a).localeCompare(trig(b)) || b.triggered_at.localeCompare(a.triggered_at))
    else arr.sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))
    return arr
  }, [filtered, sort])

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-ink">Alerts</h1>
          {unreadCount > 0 && (
            <span className="bg-alert text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </div>
        {/* Needs attention = real alerts · Zone log = the silent comings-and-
            goings record (powers pins + site history, never pages anyone) */}
        <div className="flex items-center gap-0.5 bg-navy-900 rounded-lg p-0.5 border border-navy-800 w-fit">
          <button
            onClick={() => setTab('alerts')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${tab === 'alerts' ? 'bg-alert/20 text-alert' : 'text-faint hover:text-ink'}`}
          >
            Needs attention ({alerts.length - activityCount})
          </button>
          <button
            onClick={() => setTab('activity')}
            className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${tab === 'activity' ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink'}`}
          >
            Zone log ({activityCount})
          </button>
        </div>
        {/* flex-wrap: All + Unread + 4 sort pills + Acknowledge-all is ~600px
            — on a 360px phone the un-wrapped row clipped "Acknowledge all"
            off-screen exactly when it mattered (ship-check P1). */}
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${filter === 'all' ? 'bg-amber text-[#1a1100]' : 'bg-navy-800 text-muted'}`}
          >
            All ({tabbed.length})
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${filter === 'unread' ? 'bg-alert text-white' : 'bg-navy-800 text-muted'}`}
          >
            Unread ({unreadCount})
          </button>
          <SortPills<SortKey>
            options={[['newest', 'Newest'], ['asset', 'By asset'], ['type', 'By type'], ['zone', 'By zone']]}
            value={sort}
            onChange={setSort}
          />
          {unreadCount > 1 && onAcknowledgeAll && (
            <button
              onClick={onAcknowledgeAll}
              className="ml-auto px-3 py-1 rounded-full text-xs font-medium border border-navy-700 text-faint hover:text-ink transition-colors whitespace-nowrap"
            >
              ✓ Acknowledge all
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-navy-800">
        {visible.length === 0 ? (
          filter === 'unread' ? (
            <div className="p-8 text-center text-faint">
              <CheckCheck className="h-10 w-10 mx-auto mb-2 text-[#34d399] opacity-70" />
              <p className="text-sm text-ink font-medium">All caught up</p>
              <p className="text-xs mt-1">Every alert has been acknowledged.</p>
            </div>
          ) : (
            <div className="p-8 max-w-sm mx-auto text-center">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#34d399]/10 border border-[#34d399]/25 grid place-items-center mb-3">
                <Bell className="h-6 w-6 text-[#34d399]" />
              </div>
              <p className="text-ink font-display font-bold">Quiet night. That&rsquo;s the goal.</p>
              <p className="text-sm text-faint mt-1.5 leading-relaxed">
                The second a machine moves after hours or leaves a job-site zone, the alert lands here —
                and texts your phone if SMS is set up.
              </p>
              <a href="/map" className="inline-block mt-4 text-sm font-semibold text-amber hover:underline">
                Draw a zone to guard →
              </a>
            </div>
          )
        ) : (
          visible.map((alert, i) => {
            const showHeader = sort === 'newest' && mounted &&
              (i === 0 || dateGroup(visible[i - 1].triggered_at) !== dateGroup(alert.triggered_at))
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
    </div>
  )
}

/** Local-calendar bucket for the newest-first list. Client component, so plain
 *  Date math runs in the viewer's own timezone — same treatment as the
 *  formatRelativeTime stamps below. */
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
