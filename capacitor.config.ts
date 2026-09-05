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
    // Opens the APP, not the marketing site (Brian, Aug 28: the first screen
    // after downloading was the splash page — hamburger nav, "Start free
    // pilot", pricing links, all wrong for someone who already installed it).
    // /map is the right single destination for both states: the dashboard's
    // auth gate sends a signed-out visitor to /login, and a signed-in one
    // lands straight on the live map. No marketing page in between.
    // This only takes effect in a NEW build — the Play app has been in
    // production since Aug 21, so already-installed copies still request the
    // root. app/AppEntryRedirect.tsx covers those on the next web deploy.
    url: 'https://hammertrack.ai/map',
    // Never allow plain-HTTP content inside the shell.
    cleartext: false,
  },
  // Lets the web side tell "inside the app" from "mobile browser" server-side
  // (Capacitor's JS bridge is client-only), so app-inappropriate chrome can be
  // dropped without shipping another native build.
  appendUserAgent: 'HammerTrackApp/1',
  backgroundColor: '#0a1420',
  plugins: {
    // Edge-to-edge (Brian, Sep 4: "full screen like Google Maps at the top"):
    // the web view runs UNDER a transparent status bar; the web side pads
    // with env(safe-area-inset-top) (map bar floats, other pages inset).
    StatusBar: { overlaysWebView: true, style: 'DARK', backgroundColor: '#00000000' },
  },
  ios: {
    contentInset: 'automatic',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
