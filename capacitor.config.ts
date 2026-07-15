import type { CapacitorConfig } from '@capacitor/cli'

/**
 * HammerTrack native shell — Capacitor wraps the LIVE web app.
 *
 * Architecture decision (Jul 2026): the app loads https://hammertrack.ai
 * directly, so every Vercel deploy updates the iOS/Android apps instantly —
 * no store re-submission for web features. Store releases are only needed
 * when native plugins change (push, background location, camera, BLE).
 * `webDir` holds a tiny offline fallback page bundled into the binary.
 */
const config: CapacitorConfig = {
  appId: 'com.hammertrack.app',
  appName: 'HammerTrack',
  webDir: 'mobile-shell',
  server: {
    url: 'https://hammertrack.ai',
    // Never allow plain-HTTP content inside the shell.
    cleartext: false,
  },
  backgroundColor: '#0a1420',
  ios: {
    contentInset: 'automatic',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
