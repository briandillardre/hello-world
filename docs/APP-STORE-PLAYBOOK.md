# App Store Playbook — HammerTrack iOS + Android

*Created Jul 15, 2026 — the day the LLC + EIN unlocked store accounts.*

## Architecture (decided)

**Capacitor thin shell around the live web app.** The native app loads
`https://hammertrack.ai` directly (`capacitor.config.ts` → `server.url`).

Why this shape — it optimizes for Brian's #1 constraint (*"keep maintenance
and new features as streamlined and simple as possible"*):

| Change type | How it ships | Store review? |
|---|---|---|
| Any web feature, fix, map layer, page | Normal Vercel deploy | **No — app updates instantly** |
| New native capability (push, camera, BLE) | Plugin + store release | Yes (1–3 days) |

One codebase. No React Native rewrite, no duplicated screens, no drift.

**Repo layout:** `capacitor.config.ts` (shell config) · `mobile-shell/`
(bundled offline-fallback page) · `android/` + `ios/` (generated native
projects, committed).

### Apple "minimum functionality" risk (Guideline 4.2)
Apple sometimes rejects pure web wrappers. Mitigation plan, in order:
1. Ship v1.0 with **push notifications** wired (theft alerts to the lock
   screen — genuinely native, and our killer feature).
2. Add **background location** for the crew phone-tracking (/track) and
   **camera** for receipt capture — both native-only capabilities.
3. In App Review notes, lead with the native capabilities + demo login.
If rejected anyway: appeal with the native feature list; worst case we bundle
more UI into the shell. Android has no equivalent rule — Play will approve
the wrapper as-is.

## Account checklist (Brian — in this order)

1. **D-U-N-S number** — FREE, **do this first, it's the longest pole**
   (typically ~2–5 business days, can take longer).
   dnb.com → "Get a D-U-N-S Number" → HAMMERTRACK LLC, Greenville SC address
   exactly as on the IRS CP 575 G. Both Apple *and* Google now require it for
   organization accounts.
2. **Apple Developer Program** — $99/yr — developer.apple.com/programs →
   enroll as **Organization** (needs the D-U-N-S, legal entity name
   HAMMERTRACK LLC, website hammertrack.ai, and an Apple ID). Org enrollment
   makes the App Store seller show "HammerTrack LLC" instead of a personal name.
3. **Google Play Console** — $25 one-time — play.google.com/console →
   **Organization** account (also wants D-U-N-S, business email on the domain,
   verified website). Org accounts skip the 12-tester/14-day closed-testing
   requirement that personal accounts have.
4. **Firebase project** (free) — needed for Android push later; also gives us
   FCM keys. console.firebase.google.com → new project "HammerTrack".

When these exist, hand over: Apple team ID + an App Store Connect invite,
Play Console invite, Firebase config files (`google-services.json` /
`GoogleService-Info.plist`).

## Build + submit (once accounts exist)

Native builds need Android Studio (any OS) and Xcode (Mac) — or a CI service.
- `npx cap sync` — pushes web config + plugins into both native projects
- **Icons/splash:** `npx @capacitor/assets generate` from a 1024×1024 logo
  (use the HammerTrack mark on navy #0a1420)
- Android: open `android/` in Android Studio → generate signed AAB → Play
  Console upload. Keep the signing keystore backed up (losing it = losing the
  app listing).
- iOS: open `ios/App` in Xcode → set the team → Archive → upload to
  App Store Connect → TestFlight first, then submit.

## Store listing prep (can be done anytime)
- Name: **HammerTrack** · subtitle: "Know where everything is"
- Privacy policy URL: hammertrack.ai/privacy ✓ (already live)
- Support URL: hammertrack.ai/contact ✓
- Screenshots: live map w/ fleet, theft alert, tools-aboard panel, timeline
  replay, clock-in — phone-frame captures at required sizes
- App Privacy questionnaire: collects location (app functionality — fleet +
  crew tracking, linked to account), contact info (account), photos (receipts,
  user-initiated). No ads, no tracking-for-advertising.

## Native roadmap after v1
1. **Push notifications** (theft alert → lock screen; the reason the app exists)
2. **Background location** — /track "Go Live" keeps reporting with screen off
3. **Camera** — receipt-chase capture flow
4. **BLE scanning** — every crew phone becomes a roaming tool-tag gateway

## Timeline (realistic)
- Day 0: D-U-N-S request submitted
- Day ~3–7: Apple + Google enrollments approved
- Same week: icons, signed builds, TestFlight + Play internal track
- Store review: Apple 1–3 days, Google similar for new apps
- **Live in roughly 2–3 weeks**, gated almost entirely by account approvals
