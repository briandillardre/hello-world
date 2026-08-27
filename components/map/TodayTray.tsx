'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { X, Siren, WifiOff, Wrench, DollarSign, Sun, Sparkles } from 'lucide-react'
import type { AlertEvent, AssetWithLocation } from '@/lib/types'

interface TrayInsight {
  id: string
  detector: string
  severity: number
  headline: string
  link: string | null
}

/**
 * TODAY — the morning exceptions card, ON the map (Brian, Aug 22: "pop up
 * on the map, not a full page"). The ChatGPT-doc's "Today screen," sized to
 * a glance: at most four lines, each one a real exception with a deep link.
 * Shows once per local day (first open after 5 AM), dismisses until
 * tomorrow, and never renders when there's nothing to say — a quiet
 * morning needs no card.
 */

const SEEN_KEY = 'ht_today_seen'

const localDayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function TodayTray({ assets, alerts, canViewCosts = false }: {
  assets: AssetWithLocation[]
  alerts: AlertEvent[]
  canViewCosts?: boolean
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    // The gate re-checks when the tab wakes up and on a coarse tick — a phone
    // left on /map overnight (or a PWA resumed at 7 AM) crosses 5 AM and day
    // boundaries without ever re-mounting this component (ship-check).
    const check = () => {
      try {
        if (new Date().getHours() < 5) return
        if (localStorage.getItem(SEEN_KEY) === localDayKey()) return
        setOpen(true)
      } catch { /* private mode — skip quietly */ }
    }
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    const tick = window.setInterval(check, 15 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(tick)
    }
  }, [])
  const dismiss = () => {
    setOpen(false)
    try { localStorage.setItem(SEEN_KEY, localDayKey()) } catch { /* private mode */ }
  }

  // Insight-engine findings (severity ≥2 only — the card is a glance, not a
  // feed). Fetched once the card decides to show; a failed fetch just means
  // the card shows its local rows, never a broken morning.
  const [insights, setInsights] = useState<TrayInsight[]>([])
  // Sticky: once the engine has (or had) an idle_money story this session,
  // the engine owns idleness — dismissing its row must NOT resurrect the
  // local "parked machines" snapshot in the same slot (ship-check).
  const [engineOwnsIdle, setEngineOwnsIdle] = useState(false)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch('/api/insights')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !Array.isArray(j?.insights)) return
        const rows = (j.insights as TrayInsight[]).filter((i) => i.severity >= 2).slice(0, 2)
        setInsights(rows)
        if ((j.insights as TrayInsight[]).some((i) => i.detector === 'idle_money')) setEngineOwnsIdle(true)
      })
      .catch(() => { /* quiet */ })
    return () => { cancelled = true }
  }, [open])
  const dismissInsight = (id: string) => {
    setInsights((prev) => prev.filter((i) => i.id !== id))
    fetch('/api/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => { /* it re-suppresses server-side next run anyway */ })
  }

  const rows = useMemo(() => {
    const out: { key: string; icon: React.ReactNode; text: string; href: string; critical?: boolean; insightId?: string }[] = []
    const unread = alerts.filter((a) =>
      !a.acknowledged_at && !(!a.kind && (a.rule?.trigger === 'enter' || a.rule?.trigger === 'exit')))
    if (unread.length) {
      const critical = unread.some((a) => !a.kind && (a.rule?.trigger === 'after_hours_movement' || a.rule?.trigger === 'left_site'))
      out.push({
        key: 'alerts', critical,
        icon: <Siren className={`h-4 w-4 ${critical ? 'text-alert' : 'text-amber'}`} />,
        text: `${unread.length} alert${unread.length === 1 ? '' : 's'} need${unread.length === 1 ? 's' : ''} attention${critical ? ' — includes after-hours movement' : ''}`,
        href: '/alerts',
      })
    }
    // Silent = has a tracker but stale 48h+ — OR has a tracker that has NEVER
    // reported (no location at all), the failure mode a brand-new install hits.
    const silent = assets.filter((a) =>
      (a.type === 'vehicle' || a.type === 'equipment') && (
        (a.location && Date.now() - new Date(a.location.timestamp).getTime() > 48 * 3_600_000) ||
        (!a.location && !!a.tracker_id)
      ))
    if (silent.length) {
      out.push({
        key: 'silent',
        icon: <WifiOff className="h-4 w-4 text-amber" />,
        text: silent.length === 1
          ? (silent[0].location ? `${silent[0].name} hasn't reported in 2+ days` : `${silent[0].name}'s tracker has never reported`)
          : `${silent.length} trackers silent 2+ days (${silent.slice(0, 2).map((a) => a.name).join(', ')}${silent.length > 2 ? '…' : ''})`,
        href: silent.length === 1 ? `/assets/${silent[0].id}` : '/assets',
      })
    }
    const service = assets.filter((a) => ((a.maintOverdue ?? 0) + (a.openWorkOrders ?? 0)) > 0)
    if (service.length) {
      out.push({
        key: 'service',
        icon: <Wrench className="h-4 w-4 text-teal" />,
        text: `${service.length} machine${service.length === 1 ? '' : 's'} with service due or open work orders`,
        href: '/maintenance',
      })
    }
    if (canViewCosts) {
      // The engine's idle_money story (7d+ streak with cumulative $) replaces
      // this local snapshot when it's live — one idleness story, not two,
      // and a dismissed engine story stays replaced (engineOwnsIdle sticks).
      const burners = engineOwnsIdle ? [] : assets.filter((a) => (a.idleDays ?? -1) >= 2 && (a.daily_cost ?? 0) > 0)
      if (burners.length) {
        const dollars = burners.reduce((s, a) => s + (a.idleDays ?? 0) * (a.daily_cost ?? 0), 0)
        out.push({
          key: 'idle',
          icon: <DollarSign className="h-4 w-4 text-alert" />,
          text: `${burners.length} parked machine${burners.length === 1 ? '' : 's'} burning ~$${Math.round(dollars).toLocaleString()} idle`,
          href: burners.length === 1 ? `/assets/${burners[0].id}` : '/assets',
        })
      }
    }
    // Weave the engine's findings in after the alert row: the ✨ rows are
    // the "AI noticed" moments, each dismissible on its own.
    const insightRows = insights.map((i) => ({
      key: `insight-${i.id}`,
      insightId: i.id,
      critical: i.severity >= 3,
      icon: <Sparkles className={`h-4 w-4 ${i.severity >= 3 ? 'text-alert' : 'text-amber'}`} />,
      text: i.headline,
      // Relative app paths only — a future link writer must never be able
      // to turn a tray row into an outbound or javascript: link (sec-check).
      href: i.link && i.link.startsWith('/') ? i.link : '/reports',
    }))
    const alertRow = out.filter((r) => r.key === 'alerts')
    const rest = out.filter((r) => r.key !== 'alerts')
    return [...alertRow, ...insightRows, ...rest].slice(0, 4)
  }, [assets, alerts, canViewCosts, insights, engineOwnsIdle])

  if (!open || rows.length === 0) return null

  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-2 z-30 w-[min(400px,94vw)] rounded-2xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-navy-800">
        <Sun className="h-4 w-4 text-amber flex-none" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-amber">
          Today · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
        </span>
        <button onClick={dismiss} aria-label="Dismiss until tomorrow" className="ml-auto p-1.5 -m-1 text-faint hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="divide-y divide-navy-800/60">
        {rows.map((r) => (
          <Link
            key={r.key}
            href={r.href}
            onClick={dismiss}
            className={`flex items-center gap-3 px-4 py-2.5 text-[13px] leading-snug hover:bg-navy-900 transition-colors ${r.critical ? 'bg-alert/10 text-ink' : 'text-muted'}`}
          >
            <span className="flex-none">{r.icon}</span>
            <span className="min-w-0 flex-1">{r.text}</span>
            {r.insightId && (
              <button
                aria-label="Dismiss this finding"
                title="Dismiss — it comes back only if it grows"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismissInsight(r.insightId!) }}
                className="flex-none p-1 -m-1 text-faint hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <span className="text-faint flex-none">→</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
