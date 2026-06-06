# HammerTrack — Mobile App Plan (iPhone + Android)

> Status: **PLANNED / deferred.** Web + design system ship first. This is the
> blueprint to execute when apps are greenlit. No app code exists yet.

## Decision: wrap the web app with Capacitor

We ship the existing Next.js app inside a thin native shell (Capacitor) rather
than rebuilding in React Native or going fully native (Swift/Kotlin).

**Why this is the right call for HammerTrack:**
- The phone's job is **view the live map + receive alerts**. The Bluetooth tool
  tracking happens on the *truck/equipment* gateways (Teltonika), **not** the
  phone — so we don't need deep native BLE on the handset. That removes the #1
  reason teams go fully native.
- One codebase. Every web feature (map, assets, alerts, maintenance, reports,
  QuickBooks) is instantly in the apps. No second product to maintain.
- The only truly-native need is **push notifications** ("excavator left at
  2 AM") — Capacitor handles that with a first-class plugin.
- Fastest path to the App Store + Play Store with a polished, branded icon and
  splash — which is what "having an app" means to a contractor evaluating us
  next to Tenna.

**When to revisit:** if we later move tool-tag scanning onto crew phones, or
need heavy offline map caching, reassess React Native for those screens.

## Architecture

```
Next.js app (already built)
        │
        ├── Web  → Netlify (hammertrackai.com)  [today]
        │
        └── Capacitor shell → native iOS + Android binaries
                 ├─ @capacitor/push-notifications  (theft/left-site alerts)
                 ├─ @capacitor/geolocation         (center map on the user)
                 ├─ @capacitor/app + Deep Links     (open alert → asset screen)
                 ├─ @capacitor/status-bar + splash  (branded chrome)
                 └─ @capacitor/preferences          (auth token / session)
```

Two ways to serve the web content into the shell — pick at build time:
1. **Remote URL (recommended to start):** shell loads `https://hammertrackai.com`.
   App updates the instant the website deploys; no app-store review for content
   changes. Requires a thin native layer for push + deep links.
2. **Bundled static export:** ship HTML/JS inside the binary (works offline,
   feels snappier) but every change needs a store release. Move here later if
   offline matters.

> Note: Next.js App Router + Capacitor static export needs care (server
> components, API routes). Starting with the **remote URL** approach sidesteps
> that entirely and is the fastest route to a shippable build.

## Push notifications (the one feature that justifies "native")

- iOS: APNs key from Apple Developer account.
- Android: Firebase Cloud Messaging (FCM) project.
- Server: the existing **alerts-engine** (`lib/alerts-engine.ts`) already
  decides *when* an alert fires. Add a delivery step that, on a fired alert,
  also sends APNs/FCM to the org's registered devices. Store device tokens in
  Supabase (`device_tokens` table keyed by user/org).
- Tap an alert → deep-link into `/assets/{id}` or `/map?focus={id}`.

## Phased rollout

**Phase 0 — Web first (current work).** Land the design system + polished
homepage. Confirm the PWA installs cleanly (manifest/icons/splash) — this is a
free "app-like" stopgap on both platforms while native is in review.

**Phase 1 — Capacitor shell (≈ few days once greenlit).**
- Add Capacitor, generate iOS + Android projects.
- Point shell at the remote URL. Branded app icon + splash from final logo.
- Status bar / safe-area polish (largely done in `globals.css` already).
- Internal TestFlight + Android internal-track build.

**Phase 2 — Push notifications.**
- Wire APNs + FCM, device-token registration on login, server delivery from the
  alerts engine, deep-link tap-through.

**Phase 3 — Store submission.**
- App Store + Play Store listings (icon, screenshots from the live map,
  description, privacy labels). Apple's "minimum functionality" rule is met
  because we add real push + native chrome, not just a webview.

**Phase 4 — Native niceties (optional, later).**
- Biometric unlock, background-location nudges, offline map tiles, home-screen
  alert widget.

## Accounts / prerequisites (you, when we start)
- **Apple Developer Program** — $99/yr (required to ship to iPhone).
- **Google Play Developer** — $25 one-time.
- **Firebase project** — free tier, for Android push (FCM).
- A final **logo** in vector → generates every icon + splash size.

## What stays unchanged
The web app remains the single source of truth. Building the apps adds a
`capacitor/` shell + a push-delivery step on the server — it does **not** fork
the product.
