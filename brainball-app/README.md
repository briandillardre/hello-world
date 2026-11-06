# Brain Ball — native shell (its own app)

Separate Capacitor wrapper around the live game at **https://hammertrack.ai/play**,
built exactly like HammerTrack's shell: the app loads the live site, so every web
deploy updates installed apps instantly. Store releases are only needed when native
bits change — and this app deliberately has almost none.

- **App id:** `com.hammertrack.brainball` · name **Brain Ball** · portrait-locked
- **Only native plugin:** StatusBar (edge-to-edge; the game already pads safe areas)
- **No push, no location, no Bluetooth, no camera, no third-party ads/analytics** —
  that's the Kids Category / Play Families posture, keep it that way
- `shell/index.html` is the bundled offline page (`server.errorPath`): kid words,
  auto-reconnect with a doubling retry
- Icons + splashes are generated into both platforms from `assets/logo.png`
  (`npm run icons` regenerates after a logo change; source of truth is
  `public/icons/brainball-512.png` in the repo root)

## Android (ready now)

Committed `android/` project: versionCode 1 / versionName 1.0.0, signing config
reads the same `ANDROID_KEYSTORE_*` env vars as HammerTrack (one upload keystore
signs both apps; Play App Signing keeps per-app keys).

Release = dispatch the **`brainball-android-release`** workflow on master.
Play rejects a reused versionCode — bump `android/app/build.gradle` before every
dispatch, same rule as HammerTrack.

**One-time, Brian (Play's API cannot create an app):**
1. Play Console (the existing HammerTrack org account) → Create app → "Brain Ball".
2. Fill **Data safety** + **target audience / Families** questionnaires — the exact
   answers live in `docs/BRAIN_BALL.md` → "App Store / Google Play plan"
   (accounts-enabled build: parent email + game progress, optional, not shared,
   no ads; kids never sign in themselves).
3. Upload the first AAB by hand (run the workflow with `upload: false`, grab the
   `brainball-release` artifact).
4. Grant the existing Play service account access to the new app
   (Users and permissions) — after that, releases are hands-off.

## iOS (blocked on the Apple enrollment, like HammerTrack)

Committed `ios/` project (SPM-based, icons/splashes in place). When the Apple
Developer enrollment clears:
1. Open `ios/App` in Xcode, set the team, bundle id `com.hammertrack.brainball`.
2. Kids Category checklist: no third-party ads/analytics (true), parental gate
   before external links — the game's grown-ups math gate already covers its one
   gated area; the shell adds no links of its own.
3. Archive → App Store Connect, or wire a `brainball-ios-testflight` workflow
   off the `ios-testflight` pattern once `ASC_*` secrets exist.

## Day-to-day

- Config lives in `capacitor.config.ts`; after changing it: `npx cap sync`.
- A config/plugin change needs a native rebuild + store release; game changes
  never do (they're web deploys).
- The shell sends `BrainBallApp/1` in the user agent if the web side ever needs
  to detect "inside the kids' app".
