'use client'

import { useState } from 'react'
import { Bell, CheckCheck, AlertTriangle, MapPin, Clock } from 'lucide-react'
import type { AlertEvent, AlertRule } from '@/lib/types'
import { formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const TRIGGER_LABELS: Record<AlertRule['trigger'], string> = {
  enter: 'Entered zone',
  exit: 'Exited zone',
  idle: 'Idle too long',
  after_hours_movement: 'THEFT ALERT',
  left_site: 'Left job site',
}

const TRIGGER_COLORS: Record<AlertRule['trigger'], 'default' | 'destructive' | 'secondary'> = {
  enter: 'default',
  exit: 'destructive',
  idle: 'secondary',
  after_hours_movement: 'destructive',
  left_site: 'destructive',
}

const CRITICAL_TRIGGERS: AlertRule['trigger'][] = ['after_hours_movement', 'left_site']

interface AlertListProps {
  alerts: AlertEvent[]
  onAcknowledge?: (id: string) => void
  onAcknowledgeAll?: () => void
}

export function AlertList({ alerts, onAcknowledge, onAcknowledgeAll }: AlertListProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const unreadCount = alerts.filter(a => !a.acknowledged_at).length
  const visible = filter === 'unread' ? alerts.filter(a => !a.acknowledged_at) : alerts

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
        <div className="flex gap-2 items-center">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${filter === 'all' ? 'bg-amber text-[#1a1100]' : 'bg-navy-800 text-muted'}`}
          >
            All ({alerts.length})
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${filter === 'unread' ? 'bg-alert text-white' : 'bg-navy-800 text-muted'}`}
          >
            Unread ({unreadCount})
          </button>
          {unreadCount > 1 && onAcknowledgeAll && (
            <button
              onClick={onAcknowledgeAll}
              className="ml-auto px-3 py-1 rounded-full text-xs font-medium border border-navy-700 text-faint hover:text-ink transition-colors"
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
          visible.map(alert => (
            <AlertRow key={alert.id} alert={alert} onAcknowledge={onAcknowledge} />
          ))
        )}
      </div>
    </div>
  )
}

function AlertRow({ alert, onAcknowledge }: { alert: AlertEvent; onAcknowledge?: (id: string) => void }) {
  const trigger = alert.rule?.trigger ?? 'exit'
  const isUnread = !alert.acknowledged_at
  const isCritical = CRITICAL_TRIGGERS.includes(trigger)
  const assetName = alert.asset?.name ?? 'Unknown Asset'
  const zoneName = alert.rule?.geofence?.name ?? 'Unknown Zone'

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

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-ink">{assetName}</span>
          <Badge variant={TRIGGER_COLORS[trigger]}>{TRIGGER_LABELS[trigger]}</Badge>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted mt-0.5">
          <MapPin className="h-3 w-3" />
          {zoneName}
        </div>
        {/* suppressHydrationWarning: "Xm ago" drifts between server render and
            client hydration — cosmetic, not worth a mismatch error. */}
        <p className="text-xs text-faint mt-0.5" suppressHydrationWarning>{formatRelativeTime(alert.triggered_at)}</p>
      </div>

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
