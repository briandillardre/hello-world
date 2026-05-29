'use client'

import { useState } from 'react'
import { AlertList } from '@/components/alerts/AlertList'
import { MOCK_ALERTS } from '@/lib/mock-data'
import type { AlertEvent } from '@/lib/types'

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertEvent[]>(MOCK_ALERTS)

  const handleAcknowledge = (id: string) => {
    setAlerts(prev =>
      prev.map(a => a.id === id ? { ...a, acknowledged_at: new Date().toISOString() } : a)
    )
  }

  return (
    <div className="h-full overflow-hidden flex flex-col pb-[70px] md:pb-0">
      <AlertList alerts={alerts} onAcknowledge={handleAcknowledge} />
    </div>
  )
}
