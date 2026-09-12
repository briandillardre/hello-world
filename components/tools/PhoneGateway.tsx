'use client'

import { useEffect, useState } from 'react'
import { Radio } from 'lucide-react'
import { isNativeApp } from '@/lib/native'
import { parseIBeacon, APPLE_COMPANY_ID } from '@/lib/ble'

/**
 * The phone as a BLE gateway (Brian, Sep 9: "phone as ble gateway is a must";
 * Sep 12: "this should happen always thru the app"). Mounted once in the
 * dashboard shell, native app only, and ON BY DEFAULT there — a crew phone is
 * a gateway from its first launch without anyone finding a switch. It keeps
 * the LOUDEST reading per tag over each 20-second window and posts those
 * sightings with the phone's fix to /api/ingest/ble-phone — the same door a
 * truck's box uses via flespi, so the tools near you ride with you on the map.
 *
 * Always-on means battery discipline is not optional:
 *  - the radio listens for SCAN_MS of each WINDOW_MS and sleeps the rest (a
 *    tag advertises about once a second, so ten seconds hears everything in
 *    range);
 *  - a location fix is only taken when something was actually heard, so a
 *    phone with no tags near it costs nothing but the short listen.
 *
 * Scanning stops the moment the switch goes off or the component unmounts.
 * Background scanning with the app closed is the native update's job (#57).
 *
 * The FIRST scan on a phone summons the OS Bluetooth prompt ("Nearby
 * devices" / "Use Bluetooth"), so it gets the same treatment as location: a
 * one-time card that says why in plain words BEFORE the prompt. Cold-prompting
 * a crew member gets a Deny that kills the feature on that phone forever —
 * and an unexplained prompt is exactly what Play's disclosure rule is about.
 * One showing per device; after that the gateway just runs.
 */
const KEY = 'ht_phone_gateway'
/** Stamped the one time the pre-prompt card appears — never a second showing. */
const PRIMER_KEY = 'ht_ble_primer'
/** One report per window; the radio is only live for the first SCAN_MS of it. */
const WINDOW_MS = 20_000
const SCAN_MS = 10_000
export const GATEWAY_EVENT = 'ht:phone-gateway'
export const GATEWAY_STATUS_EVENT = 'ht:phone-gateway-status'
export interface GatewayStatus { on: boolean; heard: number; matched: number; holding: number; reportedAt: number | null; error: string | null }

/**
 * On inside the app, off in a browser. An UNSET key reads as on in the shell
 * (Brian: always, through the app); an explicit '0' — someone turned the
 * switch off, or a 403 turned it off for them — still wins.
 */
function stored(): '1' | '0' | null {
  try { const v = localStorage.getItem(KEY); return v === '1' || v === '0' ? v : null } catch { return null }
}
export function phoneGatewayEnabled(): boolean {
  const v = stored()
  if (v) return v === '1'
  return isNativeApp()
}
export function setPhoneGateway(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GATEWAY_EVENT, { detail: { on } }))
}

interface ScanResultLike { device: { deviceId: string; name?: string }; localName?: string; rssi?: number; manufacturerData?: Record<string, DataView> }

export function PhoneGateway() {
  const [on, setOn] = useState(false)
  const [ask, setAsk] = useState(false)

  useEffect(() => {
    if (!isNativeApp()) return
    const h = (e: Event) => { setAsk(false); setOn(!!(e as CustomEvent<{ on: boolean }>).detail?.on) }
    window.addEventListener(GATEWAY_EVENT, h)

    let cancelled = false
    const decide = () => {
      if (cancelled) return
      const choice = stored()
      if (choice) { setOn(choice === '1'); return }
      let seen = true
      try { seen = !!localStorage.getItem(PRIMER_KEY) } catch { /* private mode: treat as seen */ }
      // Seen the explanation before (or can't remember) — just be a gateway.
      if (seen) { setOn(true); return }
      try { localStorage.setItem(PRIMER_KEY, String(Date.now())) } catch { /* fine */ }
      setAsk(true)
    }
    // The location primer owns the first screen; queue behind it so two
    // sheets never stack on a new install.
    if (typeof document !== 'undefined' && document.documentElement.dataset.htPrimer === '1') {
      const after = () => { window.removeEventListener('ht:primer-done', after); decide() }
      window.addEventListener('ht:primer-done', after)
      return () => { cancelled = true; window.removeEventListener('ht:primer-done', after); window.removeEventListener(GATEWAY_EVENT, h) }
    }
    decide()
    return () => { cancelled = true; window.removeEventListener(GATEWAY_EVENT, h) }
  }, [])

  useEffect(() => {
    if (!on) return
    let stopped = false
    let stopScan: (() => Promise<void>) | null = null
    let scanning = false
    let sleepTimer: number | null = null
    const heard = new Map<string, { id: string; rssi: number | null; at: number }>()
    // The fix carries WHEN it was taken: a phone that loses location must not
    // keep pinning tags to where it WAS (sec-check, Sep 9) — stale (> 2 min)
    // or coarse (> 250 m) fixes skip the report.
    let fix: { lat: number; lng: number; acc: number | null; heading: number | null; at: number } | null = null
    const status: GatewayStatus = { on: true, heard: 0, matched: 0, holding: 0, reportedAt: null, error: null }
    const publish = () => window.dispatchEvent(new CustomEvent(GATEWAY_STATUS_EVENT, { detail: { ...status } }))
    publish()

    // Asked for only when there is something to report, so an all-day gateway
    // that hears nothing never wakes the GPS. maximumAge lets the OS hand back
    // the shift recorder's fix when that is already running.
    const getFix = () => new Promise<typeof fix>((resolve) => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? null,
          heading: Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : null,
          at: Date.now(),
        }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
      )
    })

    const start = async () => {
      if (stopped || scanning) return
      if (sleepTimer != null) { window.clearTimeout(sleepTimer); sleepTimer = null }
      try {
        const { BleClient } = await import('@capacitor-community/bluetooth-le')
        await BleClient.initialize({ androidNeverForLocation: false })
        scanning = true
        // Assigned BEFORE the scan starts: a switch-off during initialize /
        // requestLEScan used to leave a scan running with nothing to stop it.
        stopScan = async () => { scanning = false; try { await BleClient.stopLEScan() } catch { /* already stopped */ } }
        await BleClient.requestLEScan({ allowDuplicates: true }, (r: ScanResultLike) => {
          const mac = r.device?.deviceId ?? null
          const md = r.manufacturerData?.[APPLE_COMPANY_ID]
          const ib = md ? parseIBeacon(md) : null
          const id = ib ? `${ib.uuid}:${ib.major}:${ib.minor}` : mac
          if (!id) return
          const prev = heard.get(id)
          const rssi = r.rssi ?? null
          // Loudest reading in the window wins — that is what arbitration compares.
          if (!prev || (rssi != null && (prev.rssi == null || rssi > prev.rssi))) heard.set(id, { id, rssi, at: Date.now() })
          else prev.at = Date.now()
        })
        if (stopped) { await stopScan(); return }
        // Half a window of listening is plenty; the radio sleeps the rest.
        sleepTimer = window.setTimeout(() => { sleepTimer = null; void stopScan?.() }, SCAN_MS)
        status.error = null; publish()
      } catch (e) {
        scanning = false
        const msg = e instanceof Error ? e.message : 'Scan failed.'
        status.error = /permission|denied/i.test(msg) ? 'Bluetooth or location permission was denied — allow it in system settings.' : /enabled|off|state/i.test(msg) ? 'Bluetooth is off.' : msg
        publish()
      }
    }

    const report = async () => {
      const now = Date.now()
      const fresh = Array.from(heard.values()).filter((b) => now - b.at < 25_000)
      heard.clear()
      status.heard = fresh.length
      if (!fresh.length) { publish(); return }
      if (!fix || now - fix.at > 60_000) fix = await getFix()
      if (stopped) return
      if (!fix || Date.now() - fix.at > 120_000) {
        status.error = 'Location is off — the tags need a place to land.'
        publish(); return
      }
      if (fix.acc != null && fix.acc > 250) {
        status.error = 'Location is too rough right now to place the tags.'
        publish(); return
      }
      try {
        const res = await fetch('/api/ingest/ble-phone', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ beacons: fresh.map((b) => ({ id: b.id, rssi: b.rssi })), lat: fix.lat, lng: fix.lng, accuracy: fix.acc, heading: fix.heading }),
        })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; matched?: number; holding?: number; error?: string }
        if (res.ok && j.ok) { status.matched = j.matched ?? 0; status.holding = j.holding ?? 0; status.reportedAt = now; status.error = null }
        else if (res.status === 403) {
          // View levels changed under us (Tag scanner / Share location turned
          // off for this role) — the switch goes off, not just the report.
          status.error = 'Your view levels no longer include the Tag scanner — the switch was turned off.'
          setPhoneGateway(false)
        } else status.error = j.error ?? 'Report failed'
      } catch { status.error = 'No signal — will retry' }
      publish()
    }

    const tick = window.setInterval(() => {
      if (stopped) return
      void start()   // top of the window: radio back on
      void report()  // and send what the last one heard
    }, WINDOW_MS)

    // Scans stop when the app goes to the background; pick up again on return.
    const onVis = () => { if (document.visibilityState === 'visible') void start() }
    document.addEventListener('visibilitychange', onVis)
    void start()
    return () => {
      stopped = true
      window.clearInterval(tick)
      if (sleepTimer != null) window.clearTimeout(sleepTimer)
      document.removeEventListener('visibilitychange', onVis)
      void stopScan?.()
      window.dispatchEvent(new CustomEvent(GATEWAY_STATUS_EVENT, { detail: { on: false, heard: 0, matched: 0, holding: 0, reportedAt: null, error: null } satisfies GatewayStatus }))
    }
  }, [on])

  if (!ask) return null
  return (
    <div className="fixed inset-0 z-[88] flex items-end md:items-center justify-center bg-navy-950/70 backdrop-blur-sm">
      <div className="w-full md:max-w-sm rounded-t-2xl md:rounded-2xl border border-navy-700 bg-navy-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-panel">
        <div className="flex items-center gap-3 mb-3">
          <span className="grid place-items-center h-11 w-11 rounded-xl bg-teal/15 border border-teal/30 flex-none"><Radio className="h-5 w-5 text-teal" /></span>
          <p className="text-[15px] font-bold text-ink leading-snug">Let this phone find your tool tags</p>
        </div>
        <p className="text-[13px] text-muted leading-relaxed">
          While the app is open, HammerTrack listens for the Bluetooth tags on your tools so
          whatever you&apos;re carrying shows on the map as riding with you — the way tools ride
          with a truck. It only listens for tags; it never connects to anything else.
        </p>
        <div className="mt-4 flex gap-2">
          <button onClick={() => setPhoneGateway(true)} className="flex-1 rounded-lg bg-amber text-[#1a1100] font-display font-bold text-sm py-2.5 hover:bg-amber-600 transition-colors">
            Turn it on
          </button>
          <button onClick={() => setPhoneGateway(false)} className="rounded-lg border border-navy-700 bg-navy-950 text-muted text-sm px-4 hover:text-ink transition-colors">
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
