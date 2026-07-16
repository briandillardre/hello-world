'use client'

import { useEffect } from 'react'

/**
 * Native push registration — active ONLY inside the Capacitor app. It reaches
 * the Push plugin through the global `window.Capacitor` (no build-time
 * dependency on @capacitor/push-notifications), so the web build is unaffected
 * and this no-ops in a browser. On device it asks permission, registers, and
 * POSTs the FCM/APNs token to /api/push/register so theft alerts can hit the
 * lock screen.
 *
 * Native side (one-time, once Firebase is set up):
 *   npm i @capacitor/push-notifications && npx cap sync
 */
interface CapPlugin {
  requestPermissions?: () => Promise<{ receive?: string }>
  register?: () => Promise<void>
  addListener?: (event: string, cb: (data: unknown) => void) => void
}
interface CapGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
  Plugins?: { PushNotifications?: CapPlugin }
}

export function NativePush() {
  useEffect(() => {
    const Cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor
    if (!Cap?.isNativePlatform?.()) return // browser / PWA — nothing to do
    const Push = Cap.Plugins?.PushNotifications
    if (!Push?.register) return // plugin not installed in the native project yet

    const platform = Cap.getPlatform?.() ?? 'unknown'
    let cancelled = false

    ;(async () => {
      try {
        const perm = await Push.requestPermissions?.()
        if (cancelled || (perm?.receive && perm.receive !== 'granted')) return
        Push.addListener?.('registration', (data: unknown) => {
          const token = (data as { value?: string })?.value
          if (!token) return
          fetch('/api/push/register', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token, platform }),
            keepalive: true,
          }).catch(() => { /* registration retries next launch */ })
        })
        await Push.register?.()
      } catch { /* push is best-effort — never break the app */ }
    })()

    return () => { cancelled = true }
  }, [])
  return null
}
