'use client'

import { useEffect, useState } from 'react'
import { isNativeApp } from '@/lib/native'
import { parseIBeacon, APPLE_COMPANY_ID } from '@/lib/ble'

/**
 * The phone as a BLE gateway (Brian, Sep 9: "phone as ble gateway is a
 * must"). Mounted once in the dashboard shell, native app only. While the
 * switch on the Tag scanner page is on and the app is in the foreground, it
 * scans continuously, keeps the LOUDEST reading per tag over each 20-second
 * window, and posts those sightings with the phone's fix to
 * /api/ingest/ble-phone — the same door a truck's box uses via flespi, so the
 * tools near you ride with you on the map. Scanning stops the moment the
 * switch goes off or the component unmounts (a scan left running flattens a
 * battery). Background scanning is the native update's job (task #57).
 */
const KEY = 'ht_phone_gateway'
export const GATEWAY_EVENT = 'ht:phone-gateway'
export const GATEWAY_STATUS_EVENT = 'ht:phone-gateway-status'
export interface GatewayStatus { on: boolean; heard: number; matched: number; holding: number; reportedAt: number | null; error: string | null }

export function phoneGatewayEnabled(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}
export function setPhoneGateway(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GATEWAY_EVENT, { detail: { on } }))
}

interface ScanResultLike { device: { deviceId: string; name?: string }; localName?: string; rssi?: number; manufacturerData?: Record<string, DataView> }

export function PhoneGateway() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!isNativeApp()) return
    setOn(phoneGatewayEnabled())
    const h = (e: Event) => setOn(!!(e as CustomEvent<{ on: boolean }>).detail?.on)
    window.addEventListener(GATEWAY_EVENT, h)
    return () => window.removeEventListener(GATEWAY_EVENT, h)
  }, [])

  useEffect(() => {
    if (!on) return
    let stopped = false
    let stopScan: (() => Promise<void>) | null = null
    let scanning = false
    const heard = new Map<string, { id: string; rssi: number | null; at: number }>()
    let fix: { lat: number; lng: number; acc: number | null; heading: number | null } | null = null
    const status: GatewayStatus = { on: true, heard: 0, matched: 0, holding: 0, reportedAt: null, error: null }
    const publish = () => window.dispatchEvent(new CustomEvent(GATEWAY_STATUS_EVENT, { detail: { ...status } }))
    publish()

    const watch = typeof navigator !== 'undefined' && 'geolocation' in navigator
      ? navigator.geolocation.watchPosition(
          (p) => { fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy ?? null, heading: Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : null } },
          () => { status.error = 'Location is off — the tags need a place to land.'; publish() },
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
        )
      : null

    const start = async () => {
      if (stopped || scanning) return
      try {
        const { BleClient } = await import('@capacitor-community/bluetooth-le')
        await BleClient.initialize({ androidNeverForLocation: false })
        scanning = true
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
        stopScan = async () => { scanning = false; try { await BleClient.stopLEScan() } catch { /* already stopped */ } }
        status.error = null; publish()
      } catch (e) {
        scanning = false
        const msg = e instanceof Error ? e.message : 'Scan failed.'
        status.error = /permission|denied/i.test(msg) ? 'Bluetooth or location permission was denied — allow it in system settings.' : /enabled|off|state/i.test(msg) ? 'Bluetooth is off.' : msg
        publish()
      }
    }

    const tick = window.setInterval(async () => {
      if (stopped) return
      const now = Date.now()
      const fresh = Array.from(heard.values()).filter((b) => now - b.at < 25_000)
      heard.clear()
      status.heard = fresh.length
      if (!fresh.length || !fix) { publish(); return }
      try {
        const res = await fetch('/api/ingest/ble-phone', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ beacons: fresh.map((b) => ({ id: b.id, rssi: b.rssi })), lat: fix.lat, lng: fix.lng, accuracy: fix.acc, heading: fix.heading }),
        })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; matched?: number; holding?: number; error?: string }
        if (res.ok && j.ok) { status.matched = j.matched ?? 0; status.holding = j.holding ?? 0; status.reportedAt = now; status.error = null }
        else status.error = j.error ?? 'Report failed'
      } catch { status.error = 'No signal — will retry' }
      publish()
    }, 20_000)

    // Scans stop when the app goes to the background; pick up again on return.
    const onVis = () => { if (document.visibilityState === 'visible') void start() }
    document.addEventListener('visibilitychange', onVis)
    void start()
    return () => {
      stopped = true
      window.clearInterval(tick)
      if (watch != null) navigator.geolocation.clearWatch(watch)
      document.removeEventListener('visibilitychange', onVis)
      void stopScan?.()
      window.dispatchEvent(new CustomEvent(GATEWAY_STATUS_EVENT, { detail: { on: false, heard: 0, matched: 0, holding: 0, reportedAt: null, error: null } satisfies GatewayStatus }))
    }
  }, [on])

  return null
}
