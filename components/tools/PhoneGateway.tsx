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
 *    range), and it stops the moment the app leaves the screen;
 *  - a location fix is only taken when something was actually heard, so a
 *    phone with no tags near it costs nothing but the short listen;
 *  - a phone that has not MOVED and hears the same tags repeats itself at most
 *    once every QUIET_MS — otherwise a truck parked with five tagged tools
 *    would write three near-identical rows a minute, all day, into the same
 *    table the hours ledger and the trail rollups scan.
 *
 * The FIRST scan on a phone summons the OS Bluetooth prompt ("Nearby
 * devices" / "Use Bluetooth"), so it gets the same treatment as location: a
 * one-time card that says why in plain words BEFORE the prompt, and only once
 * the location primer is done with the screen. Cold-prompting a crew member
 * gets a Deny that kills the feature on that phone forever — and an
 * unexplained prompt is exactly what Play's disclosure rule is about.
 *
 * A refusal is FINAL for the session (ship-check, Sep 12): the plugin's
 * initialize() re-requests the permission on every call, so retrying each
 * window would throw the system dialog over whatever the person is doing and
 * earn the second denial Android treats as permanent. Scanning stops when the
 * switch goes off or the component unmounts. Background scanning with the app
 * closed is the native update's job (#57).
 */
const KEY = 'ht_phone_gateway'
/** Stamped when the pre-prompt card is actually SEEN — never a second showing. */
const PRIMER_KEY = 'ht_ble_primer'
/** One report per window; the radio is only live for the first SCAN_MS of it. */
const WINDOW_MS = 20_000
const SCAN_MS = 10_000
/** A parked phone hearing the same tags repeats itself at most this often. */
const QUIET_MS = 300_000
/** Under this much movement a report counts as "the same place". */
const MOVED_M = 25
export const GATEWAY_EVENT = 'ht:phone-gateway'
export const GATEWAY_STATUS_EVENT = 'ht:phone-gateway-status'
export interface GatewayStatus { on: boolean; heard: number; matched: number; holding: number; reportedAt: number | null; error: string | null }

function stored(): '1' | '0' | null {
  try { const v = localStorage.getItem(KEY); return v === '1' || v === '0' ? v : null } catch { return null }
}
/**
 * On inside the app, off in a browser. An UNSET key reads as on in the shell
 * (Brian: always, through the app); an explicit '0' — someone turned the
 * switch off, or a 403 turned it off for them — still wins.
 */
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

/** Metres between two fixes — flat-earth is plenty at this scale. */
function metresApart(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111_320
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

export function PhoneGateway({ allowed = true }: {
  /** The caller's view levels cover both the Tag scanner and Share location.
   *  Without them every report would 403, so the radio never arms at all. */
  allowed?: boolean
}) {
  const [on, setOn] = useState(false)
  const [ask, setAsk] = useState(false)

  useEffect(() => {
    if (!isNativeApp() || !allowed) return
    const h = (e: Event) => { setAsk(false); setOn(!!(e as CustomEvent<{ on: boolean }>).detail?.on) }
    window.addEventListener(GATEWAY_EVENT, h)

    let done = false
    const decide = () => {
      if (done) return
      done = true
      const choice = stored()
      if (choice) { setOn(choice === '1'); return }
      let seen = true
      try { seen = !!localStorage.getItem(PRIMER_KEY) } catch { /* private mode: treat as seen */ }
      // Seen the explanation before (or can't remember) — just be a gateway.
      if (seen) { setOn(true); return }
      try { localStorage.setItem(PRIMER_KEY, String(Date.now())) } catch { /* fine */ }
      setAsk(true)
    }

    // The location primer owns the first screen, and it raises its flag a
    // render AFTER this effect runs — so check on a later tick, never now, or
    // the card is created underneath it and burnt (ship-check, Sep 12).
    const after = () => { window.removeEventListener('ht:primer-done', after); decide() }
    window.addEventListener('ht:primer-done', after)
    const t = window.setTimeout(() => {
      if (document.documentElement.dataset.htPrimer !== '1') {
        window.removeEventListener('ht:primer-done', after)
        decide()
      }
    }, 400)

    return () => {
      done = true
      window.clearTimeout(t)
      window.removeEventListener('ht:primer-done', after)
      window.removeEventListener(GATEWAY_EVENT, h)
    }
  }, [allowed])

  useEffect(() => {
    if (!on) return
    let stopped = false
    let stopScan: (() => Promise<void>) | null = null
    let scanning = false
    let starting = false
    let inited = false
    // A permission refusal is final for the session; everything else backs
    // off, so a phone with Bluetooth off is not re-asked every 20 seconds.
    let refused = false
    let retryAfter = 0
    let sleepTimer: number | null = null
    const heard = new Map<string, { id: string; rssi: number | null; at: number }>()
    // The fix carries WHEN it was taken: a phone that loses location must not
    // keep pinning tags to where it WAS (sec-check, Sep 9) — stale (> 2 min)
    // or coarse (> 250 m) fixes skip the report.
    type Fix = { lat: number; lng: number; acc: number | null; heading: number | null; at: number }
    let fix: Fix | null = null
    let sent: { at: number; lat: number; lng: number; tags: string } | null = null
    const status: GatewayStatus = { on: true, heard: 0, matched: 0, holding: 0, reportedAt: null, error: null }
    const publish = () => window.dispatchEvent(new CustomEvent(GATEWAY_STATUS_EVENT, { detail: { ...status } }))
    publish()

    // Asked for only when there is something to report, so an all-day gateway
    // that hears nothing never wakes the GPS. maximumAge lets the OS hand back
    // the shift recorder's fix when that is already running — and the fix's
    // OWN timestamp is kept, so a cached one cannot read as brand new.
    const getFix = () => new Promise<Fix | null>((resolve) => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? null,
          heading: Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : null,
          at: Number.isFinite(p.timestamp) ? p.timestamp : Date.now(),
        }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
      )
    })

    const sleep = () => { if (sleepTimer != null) { window.clearTimeout(sleepTimer); sleepTimer = null } }

    const start = async () => {
      if (stopped || scanning || starting || refused || Date.now() < retryAfter) return
      starting = true
      sleep()
      try {
        const { BleClient } = await import('@capacitor-community/bluetooth-le')
        // ONCE per effect: initialize() re-requests the OS permission on every
        // call, so calling it each window would re-throw the system dialog.
        if (!inited) { await BleClient.initialize({ androidNeverForLocation: false }); inited = true }
        // Android's startScan is a silent no-op with the adapter off — without
        // this the status line would claim to be listening forever.
        if (!(await BleClient.isEnabled())) {
          retryAfter = Date.now() + 120_000
          status.error = 'Bluetooth is off — turn it on to hear your tool tags.'
          publish(); return
        }
        if (stopped) return
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
        if (/permission|denied|unauthorized|not authorized/i.test(msg)) {
          refused = true
          status.error = 'Bluetooth permission was denied — allow "Nearby devices" in system settings, then reopen the app.'
        } else if (/enabled|disabled|off|state|power/i.test(msg)) {
          retryAfter = Date.now() + 120_000
          status.error = 'Bluetooth is off — turn it on to hear your tool tags.'
        } else {
          retryAfter = Date.now() + 300_000
          status.error = msg
        }
        publish()
      } finally {
        starting = false
      }
    }

    const report = async () => {
      const now = Date.now()
      const fresh = Array.from(heard.values()).filter((b) => now - b.at < 25_000)
      heard.clear()
      status.heard = fresh.length
      if (!fresh.length) { publish(); return }
      const tags = fresh.map((b) => b.id).sort().join(',')
      const samePlace = (f: { lat: number; lng: number }) =>
        !!sent && sent.tags === tags && now - sent.at < QUIET_MS && metresApart(f, sent) < MOVED_M
      // Nothing new to say: same tags, same spot, said recently. Checked
      // against the fix we already hold BEFORE spending one on a new one.
      if (fix && samePlace(fix)) { publish(); return }
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
      if (samePlace(fix)) { publish(); return }
      try {
        const res = await fetch('/api/ingest/ble-phone', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ beacons: fresh.map((b) => ({ id: b.id, rssi: b.rssi })), lat: fix.lat, lng: fix.lng, accuracy: fix.acc, heading: fix.heading }),
        })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; matched?: number; holding?: number; error?: string }
        if (res.ok && j.ok) {
          status.matched = j.matched ?? 0; status.holding = j.holding ?? 0; status.reportedAt = now; status.error = null
          sent = { at: now, lat: fix.lat, lng: fix.lng, tags }
        } else if (res.status === 403) {
          // View levels changed under us (Tag scanner / Share location turned
          // off for this role) — the switch goes off, not just the report.
          status.error = 'Your view levels no longer include the Tag scanner — the switch was turned off.'
          setPhoneGateway(false)
        } else if (res.status === 409) {
          // They turned Share location off. That has to mean it, so the
          // gateway stands down rather than putting their dot back on the
          // map through the back door.
          status.error = 'Location sharing is off, so tags stay off the map. Turn sharing back on to hear them.'
          setOn(false)
        } else status.error = j.error ?? 'Report failed'
      } catch { status.error = 'No signal — will retry' }
      publish()
    }

    const tick = window.setInterval(() => {
      if (stopped) return
      if (document.visibilityState === 'visible') void start() // top of the window: radio back on
      void report()                                            // and send what the last one heard
    }, WINDOW_MS)

    // Leaving the screen STOPS the radio — Android does not unregister a scan
    // for us, it only stops delivering results, so a scan left armed in a
    // pocket is pure battery (ship-check, Sep 12).
    const onVis = () => {
      if (document.visibilityState === 'visible') { retryAfter = 0; void start() }
      else { sleep(); void stopScan?.() }
    }
    document.addEventListener('visibilitychange', onVis)
    void start()
    return () => {
      stopped = true
      window.clearInterval(tick)
      sleep()
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
