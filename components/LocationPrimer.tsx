'use client'

import { useEffect, useState } from 'react'
import { MapPin, CheckCircle2, Settings } from 'lucide-react'
import { isNativeApp, nativePlatform } from '@/lib/native'

/**
 * First-open location primer (Brian, Aug 30: "make it easy and obvious that
 * they need to allow full access to their GPS — first thing, first time").
 *
 * Two truths shape this:
 *  1. The OS prompt cannot be force-granted — the best any app can do is ask
 *     at the right moment with the reason in plain words. That pre-prompt is
 *     also REQUIRED: Google Play rejects location requests that arrive with
 *     no in-app disclosure, so this sheet is the compliance artifact too.
 *  2. Phones are where this matters (crew tracking + locate-me). Desktops in
 *     the office never see it.
 *
 * Flow: first open on a phone → branded sheet → "Allow location" fires the
 * real OS dialog → granted collapses to a beat of confirmation; denied flips
 * to honest per-platform instructions for turning it on in Settings. "Not
 * now" snoozes for a week rather than nagging every open. Once the browser
 * reports granted we never render again.
 */

const SNOOZE_KEY = 'ht_locprimer_snooze'
const SNOOZE_MS = 7 * 24 * 3_600_000

type Phase = 'ask' | 'granted' | 'denied'

export function LocationPrimer() {
  const [phase, setPhase] = useState<Phase | null>(null)

  useEffect(() => {
    // Phones + the native shell only. pointer:coarse is the honest "this is
    // a touch device" signal; the shell always qualifies.
    const isPhone = isNativeApp() || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
    if (!isPhone || !('geolocation' in navigator)) return
    try {
      const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0)
      if (until > Date.now()) return
    } catch { /* private mode — ask anyway */ }

    // The Permissions API tells us where we stand without prompting. Where
    // it's missing (older iOS Safari) we ask once and let the snooze carry.
    if (typeof navigator.permissions?.query === 'function') {
      navigator.permissions.query({ name: 'geolocation' })
        .then((st) => {
          if (st.state === 'granted') return // nothing to do, ever
          setPhase(st.state === 'denied' ? 'denied' : 'ask')
        })
        .catch(() => setPhase('ask'))
    } else {
      setPhase('ask')
    }
  }, [])

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)) } catch { /* fine */ }
    setPhase(null)
  }

  const request = () => {
    // getCurrentPosition is what actually summons the OS dialog. A quick
    // success collapses the sheet; denial flips to the settings guidance.
    navigator.geolocation.getCurrentPosition(
      () => {
        setPhase('granted')
        setTimeout(() => setPhase(null), 1600)
      },
      (err) => setPhase(err.code === err.PERMISSION_DENIED ? 'denied' : 'ask'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
    )
  }

  if (!phase) return null

  const platform = nativePlatform()
  const settingsPath = platform === 'ios'
    ? 'Settings → HammerTrack → Location → While Using the App'
    : platform === 'android'
      ? 'Settings → Apps → HammerTrack → Permissions → Location → Allow'
      : 'your browser’s site settings → Location → Allow'

  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center bg-navy-950/70 backdrop-blur-sm p-0 md:p-6">
      <div className="w-full md:max-w-sm rounded-t-2xl md:rounded-2xl border border-navy-700 bg-navy-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-panel">
        {phase === 'granted' ? (
          <div className="flex items-center gap-3 py-2">
            <CheckCircle2 className="h-7 w-7 text-teal flex-none" />
            <div>
              <p className="text-[15px] font-bold text-ink">Location is on</p>
              <p className="text-[12.5px] text-muted">You&apos;ll show on the live map when you Go Live.</p>
            </div>
          </div>
        ) : phase === 'denied' ? (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="grid place-items-center h-11 w-11 rounded-xl bg-alert/15 border border-alert/30 flex-none"><Settings className="h-5 w-5 text-alert" /></span>
              <p className="text-[15px] font-bold text-ink leading-snug">Location is blocked for HammerTrack</p>
            </div>
            <p className="text-[13px] text-muted leading-relaxed">
              Your phone is currently refusing location for this app, so you won&apos;t show on
              the crew map. To fix it, open <span className="text-ink font-semibold">{settingsPath}</span>, then come back.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={request} className="flex-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2.5 hover:bg-amber-600 transition-colors">
                Try again
              </button>
              <button onClick={snooze} className="rounded-lg border border-navy-700 bg-navy-950 text-muted text-sm px-4 hover:text-ink transition-colors">
                Later
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-3">
              <span className="grid place-items-center h-11 w-11 rounded-xl bg-amber/15 border border-amber/30 flex-none"><MapPin className="h-5 w-5 text-amber" /></span>
              <p className="text-[15px] font-bold text-ink leading-snug">Put yourself on the live map</p>
            </div>
            <p className="text-[13px] text-muted leading-relaxed">
              HammerTrack uses your location <span className="text-ink font-semibold">while you&apos;re using the app</span> to
              show you on the crew map, clock you in at the right site, and find the machines
              nearest you. Tap allow on the next screen.
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={request} className="flex-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2.5 hover:bg-amber-600 transition-colors">
                Allow location
              </button>
              <button onClick={snooze} className="rounded-lg border border-navy-700 bg-navy-950 text-muted text-sm px-4 hover:text-ink transition-colors">
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
