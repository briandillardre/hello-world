'use client'

import { useState } from 'react'
import { AlertList } from './AlertList'
import { AlertRulesManager } from './AlertRulesManager'
import { acknowledgeAlertAction } from '@/lib/actions/alerts'
import type { AlertEvent, AlertRule, Geofence, AssetWithLocation } from '@/lib/types'

interface Props {
  alerts: AlertEvent[]
  rules: AlertRule[]
  geofences: Geofence[]
  assets: AssetWithLocation[]
  editable: boolean
}

export function AlertsView({ alerts: initial, rules, geofences, assets, editable }: Props) {
  const [tab, setTab] = useState<'activity' | 'rules'>('activity')
  const [alerts, setAlerts] = useState(initial)

  const acknowledge = (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)))
    if (editable) acknowledgeAlertAction(id)
  }

  const unread = alerts.filter((a) => !a.acknowledged_at).length

  return (
    <div className="h-full overflow-hidden flex flex-col pb-[70px] md:pb-0">
      <div className="flex gap-1 p-2 border-b border-navy-800 bg-navy-950">
        <Tab active={tab === 'activity'} onClick={() => setTab('activity')}>
          Activity {unread > 0 && <span className="ml-1 text-[10px] bg-alert text-white rounded-full px-1.5">{unread}</span>}
        </Tab>
        <Tab active={tab === 'rules'} onClick={() => setTab('rules')}>Rules {rules.length > 0 && <span className="ml-1 text-faint">({rules.length})</span>}</Tab>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'activity' ? (
          <AlertList alerts={alerts} onAcknowledge={acknowledge} />
        ) : (
          <AlertRulesManager rules={rules} geofences={geofences} assets={assets} editable={editable} />
        )}
      </div>
    </div>
  )
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-2 rounded-lg text-sm font-semibold transition-colors ' +
        (active ? 'bg-navy-800 text-ink' : 'text-faint hover:text-ink')
      }
    >
      {children}
    </button>
  )
}
