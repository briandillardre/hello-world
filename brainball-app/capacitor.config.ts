import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Brain Ball native shell — its own app, same architecture as HammerTrack's:
 * Capacitor wraps the LIVE game at hammertrack.ai/play, so every web deploy
 * updates the installed apps instantly. Store releases are only needed when
 * native bits change — and this app deliberately has almost none: no push,
 * no location, no Bluetooth, no camera. Kids Category rules reward exactly
 * that (no third-party ads/analytics either — the game has none).
 *
 * The ONE native plugin is StatusBar, for the edge-to-edge look the game's
 * safe-area insets already expect.
 */
const config: CapacitorConfig = {
  appId: 'com.hammertrack.brainball',
  appName: 'Brain Ball',
  webDir: 'shell',
  server: {
    // Straight into the game — /play is its own front door (unlisted on the
    // marketing site), so there is no wrong first screen to redirect around.
    url: 'https://hammertrack.ai/play',
    // No signal shows the bundled page in webDir instead of Android's bare
    // "Webpage not available" — kid-friendly words, reconnects by itself.
    errorPath: 'index.html',
    cleartext: false,
  },
  // Lets the web side tell "inside the kids' app" from a mobile browser
  // server-side if it ever needs to (same pattern as HammerTrackApp/1).
  appendUserAgent: 'BrainBallApp/1',
  backgroundColor: '#bfe6ff',
  plugins: {
    StatusBar: { overlaysWebView: true, style: 'LIGHT', backgroundColor: '#00000000' },
  },
  ios: {
    contentInset: 'automatic',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
