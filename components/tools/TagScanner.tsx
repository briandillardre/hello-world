'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bluetooth, BluetoothSearching, Copy, Check, Smartphone, RefreshCw } from 'lucide-react'
import { isNativeApp, nativePlatform } from '@/lib/native'
import {
  type ScannedTag, trackerIdFor, trackerIdHexFor, proximityLabel, signalFraction,
} from '@/lib/ble'

/** Shape of a BleClient scan result — declared locally so the web build has
 *  no dependency on the native plugin (it's dynamically imported, and only
 *  inside the app where it actually exists). */
interface ScanResultLike {
  device: { deviceId: string; name?: string }
  localName?: string
  rssi?: number
  manufacturerData?: Record<string, DataView>
}

/**
 * Apple's company identifier. iBeacon frames ride inside manufacturer-specific
 * data under 0x004C, which is why we parse by company id rather than trusting
 * a plugin to hand us a typed beacon — every platform surfaces this slightly
 * differently, but the bytes are the bytes.
 */
const APPLE_COMPANY_ID = '76' // 0x004C, keyed as decimal by @capacitor-community/bluetooth-le

/** Pull UUID / major / minor out of an iBeacon manufacturer-data payload.
 *  Layout after the company id: 02 15 <16-byte UUID> <major:2> <minor:2> <tx:1> */
function parseIBeacon(view: DataView): { uuid: string; major: number; minor: number } | null {
  if (view.byteLength < 23) return null
  if (view.getUint8(0) !== 0x02 || view.getUint8(1) !== 0x15) return null
  const hex: string[] = []
  for (let i = 2; i < 18; i++) hex.push(view.getUint8(i).toString(16).padStart(2, '0'))
  const h = hex.join('')
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toUpperCase()
  return { uuid, major: view.getUint16(18), minor: view.getUint16(20) }
}

/**
 * Walk BLE tags into the system without retyping UUIDs off a vendor app.
 *
 * Deliberately native-only: Safari has no Web Bluetooth at all, and Chrome's
 * advertisement-scanning API is behind an experimental flag, so a "Scan"
 * button in a browser would be a button that lies. The web path explains that
 * and tells you what to do instead.
 */
export function TagScanner() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tags, setTags] = useState<Record<string, ScannedTag>>({})
  const [copied, setCopied] = useState<string | null>(null)
  const stopRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => { setSupported(isNativeApp()) }, [])

  // Always release the radio — a scan left running flattens a phone battery
  // in a couple of hours, and users navigate away without stopping.
  useEffect(() => () => { void stopRef.current?.() }, [])

  const start = useCallback(async () => {
    setErr(null)
    setTags({})
    try {
      const { BleClient } = await import('@capacitor-community/bluetooth-le')
      await BleClient.initialize({ androidNeverForLocation: false })
      setScanning(true)
      await BleClient.requestLEScan({ allowDuplicates: true }, (r: ScanResultLike) => {
        const now = Date.now()
        const mac = r.device?.deviceId ?? null
        const name = r.localName ?? r.device?.name ?? null
        let uuid: string | null = null
        let major: number | null = null
        let minor: number | null = null
        const md = r.manufacturerData?.[APPLE_COMPANY_ID]
        if (md) {
          const ib = parseIBeacon(md)
          if (ib) { uuid = ib.uuid; major = ib.major; minor = ib.minor }
        }
        // Key on beacon identity when it exists: a tag that randomizes its MAC
        // would otherwise appear as a new row every few seconds.
        const key = uuid ? `${uuid}:${major}:${minor}` : (mac ?? name ?? 'unknown')
        setTags((prev) => ({
          ...prev,
          [key]: {
            mac, uuid, major, minor, name,
            rssi: r.rssi ?? null,
            firstSeen: prev[key]?.firstSeen ?? now,
            lastSeen: now,
          },
        }))
      })
      stopRef.current = async () => {
        try { await BleClient.stopLEScan() } catch { /* already stopped */ }
      }
    } catch (e) {
      setScanning(false)
      const msg = e instanceof Error ? e.message : 'Scan failed.'
      setErr(
        /permission|denied/i.test(msg)
          ? 'Bluetooth or location permission was denied. Android requires location permission to scan for BLE devices — grant it in system settings and try again.'
          : /enabled|off|state/i.test(msg)
            ? 'Bluetooth is off. Turn it on and try again.'
            : msg
      )
    }
  }, [])

  const stop = useCallback(async () => {
    await stopRef.current?.()
    stopRef.current = null
    setScanning(false)
  }, [])

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
    } catch { /* clipboard blocked — the value is on screen to read */ }
  }

  // ── Web: say what's true instead of offering a dead button ───────────────
  if (supported === false) {
    return (
      <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-amber" />
          <h2 className="font-semibold text-sm text-ink">Open this in the HammerTrack app</h2>
        </div>
        <p className="text-[13px] text-muted leading-relaxed">
          Scanning for tags needs Bluetooth, and a web browser can&apos;t do it. Safari has no
          Bluetooth support at all, and Chrome&apos;s version is behind a developer flag — so a
          Scan button here would do nothing. This screen works inside the HammerTrack phone app.
        </p>
        <div className="rounded-lg border border-navy-800 bg-navy-950 p-3 space-y-2">
          <p className="text-[12.5px] text-ink font-semibold">Registering a tag without the app</p>
          <p className="text-[12px] text-muted leading-relaxed">
            Read the tag with your beacon app (FeasyBeacon, nRF Connect), then add the tool under{' '}
            <span className="text-ink">Assets → New asset → Tool</span> and set its{' '}
            <span className="text-ink">Tracker ID</span> to{' '}
            <span className="font-mono text-[11.5px] text-teal">UUID:major:minor</span> — using the
            decimal major and minor exactly as your app shows them. It matches either way.
          </p>
        </div>
      </div>
    )
  }

  if (supported === null) {
    return <div className="rounded-xl border border-navy-800 bg-navy-900 p-4 text-sm text-faint">Checking Bluetooth…</div>
  }

  const list = Object.entries(tags).sort((a, b) => (b[1].rssi ?? -999) - (a[1].rssi ?? -999))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          onClick={scanning ? stop : start}
          className={
            'inline-flex items-center gap-2 rounded-lg px-4 py-2 font-display font-bold text-sm transition-colors ' +
            (scanning
              ? 'bg-alert/15 border border-alert/40 text-alert hover:bg-alert/25'
              : 'bg-amber text-[#1a1100] hover:bg-amber-600')
          }
        >
          {scanning
            ? <><BluetoothSearching className="h-4 w-4 animate-pulse" /> Stop scanning</>
            : <><Bluetooth className="h-4 w-4" /> Scan for tags</>}
        </button>
        {scanning && (
          <span className="text-[12px] text-faint inline-flex items-center gap-1.5">
            <RefreshCw className="h-3 w-3 animate-spin" /> {list.length} found
          </span>
        )}
        <span className="ml-auto text-[11px] text-faint font-mono">{nativePlatform()}</span>
      </div>

      {err && (
        <p className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-[12.5px] text-alert leading-snug">{err}</p>
      )}

      {!scanning && list.length === 0 && !err && (
        <p className="text-[13px] text-faint leading-relaxed">
          Hold a tag near the phone and start a scan. Tags are listed strongest signal first, so
          the one in your hand rises to the top.
        </p>
      )}

      <div className="space-y-2">
        {list.map(([key, t]) => {
          const id = trackerIdFor(t)
          const hex = trackerIdHexFor(t)
          const frac = signalFraction(t.rssi)
          return (
            <div key={key} className="rounded-xl border border-navy-800 bg-navy-900 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink text-sm truncate">
                  {t.name || (t.uuid ? 'iBeacon' : 'BLE device')}
                </span>
                <span className="ml-auto text-[11px] font-mono text-faint flex-none">
                  {t.rssi ?? '—'} dBm · {proximityLabel(t.rssi)}
                </span>
              </div>
              <div className="h-1 rounded-full bg-navy-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal to-amber transition-all"
                  style={{ width: `${Math.round(frac * 100)}%` }}
                />
              </div>
              {id && (
                <button
                  onClick={() => copy(id, key)}
                  className="w-full flex items-center gap-2 rounded-lg border border-navy-700 bg-navy-950 px-2.5 py-2 text-left hover:border-teal/50 transition-colors"
                >
                  <span className="flex-1 min-w-0 font-mono text-[11px] text-teal break-all">{id}</span>
                  {copied === key
                    ? <Check className="h-3.5 w-3.5 text-teal flex-none" />
                    : <Copy className="h-3.5 w-3.5 text-faint flex-none" />}
                </button>
              )}
              <p className="text-[10.5px] text-faint leading-snug">
                Paste into the tool&apos;s <span className="text-muted">Tracker ID</span>.
                {hex && <> Gateways reporting hex would call this <span className="font-mono text-muted">{hex}</span> — the same tag, and either form matches.</>}
                {t.mac && t.uuid && <> MAC <span className="font-mono text-muted">{t.mac}</span>.</>}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
