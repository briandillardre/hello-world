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
}

const TRIGGER_COLORS: Record<AlertRule['trigger'], 'default' | 'destructive' | 'secondary'> = {
  enter: 'default',
  exit: 'destructive',
  idle: 'secondary',
}

interface AlertListProps {
  alerts: AlertEvent[]
  onAcknowledge?: (id: string) => void
}

export function AlertList({ alerts, onAcknowledge }: AlertListProps) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const unreadCount = alerts.filter(a => !a.acknowledged_at).length
  const visible = filter === 'unread' ? alerts.filter(a => !a.acknowledged_at) : alerts

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10 space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-900">Alerts</h1>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            All ({alerts.length})
          </button>
          <button
            onClick={() => setFilter('unread')}
            className={`px-3 py-1 rounded-full text-xs font-medium ${filter === 'unread' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Unread ({unreadCount})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Bell className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">{filter === 'unread' ? 'No unread alerts' : 'No alerts yet'}</p>
          </div>
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
  const assetName = alert.asset?.name ?? 'Unknown Asset'
  const zoneName = alert.rule?.geofence?.name ?? 'Unknown Zone'

  return (
    <div className={`flex items-start gap-3 p-4 transition-colors ${isUnread ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
        isUnread ? 'bg-amber-100' : 'bg-slate-100'
      }`}>
        {trigger === 'idle'
          ? <Clock className={`h-4 w-4 ${isUnread ? 'text-amber-600' : 'text-slate-400'}`} />
          : <AlertTriangle className={`h-4 w-4 ${isUnread ? 'text-amber-600' : 'text-slate-400'}`} />
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-slate-900">{assetName}</span>
          <Badge variant={TRIGGER_COLORS[trigger]}>{TRIGGER_LABELS[trigger]}</Badge>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
          <MapPin className="h-3 w-3" />
          {zoneName}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{formatRelativeTime(alert.triggered_at)}</p>
      </div>

      {isUnread && onAcknowledge && (
        <button
          onClick={() => onAcknowledge(alert.id)}
          className="flex-shrink-0 p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
          title="Mark as read"
        >
          <CheckCheck className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
