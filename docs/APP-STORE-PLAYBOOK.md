# App Store Playbook — HammerTrack iOS + Android

*Created Jul 15, 2026 — the day the LLC + EIN unlocked store accounts.*

> **Status Sep 1 2026 — Android v1.2 (versionCode 5) is BUILT, upload
> pending.** The android-release workflow produced the signed AAB on Sep 1
> (run 4, green). It carries the LOCATION permissions, the new launcher
> icons and the /map entry described below. Brian uploads it in Play Console
> → Production → Create release — or adds the `PLAY_SERVICE_ACCOUNT_JSON`
> secret (setup below) and the workflow uploads by itself from then on.
> Android has been live in Play Production since Aug 21; iOS is blocked on
> Apple's Aug 31 document request (account checklist below).
>
> **v1.2 carries the LOCATION permissions (Aug 30).**
> `AndroidManifest.xml` now declares `ACCESS_COARSE_LOCATION` +
> `ACCESS_FINE_LOCATION` (foreground only — deliberately NOT
> `ACCESS_BACKGROUND_LOCATION`, which triggers Play's heavy background-
> location review we don't need for foreground Go Live tracking). Until
> v1.2 rolls out, the installed Android app CANNOT show the OS location
> prompt — the WebView auto-denies. The web-side first-open primer
> (`components/LocationPrimer.tsx`) is live everywhere already and doubles as
> the Play-required prominent disclosure. When submitting: Play Console will
> ask for a location declaration — answer: foreground only, core feature =
> live crew map + site clock-in, disclosure shown in-app before the prompt.
>
> **The same release carries the NEW LAUNCHER ICONS (Aug 30).** Old icon was
> flat #002946 — read GRAY next to other apps at 48px (Brian's home-screen
> screenshot). New: rich navy gradient ground, white pin+hammer, AMBER
> signal arcs, regenerated at every density (legacy + round + adaptive
> foreground), plus a `<monochrome>` layer so Material-You themed-icon users
> get a crisp tinted mark instead of a blob. iOS 1024 and the Play 512
> (`store-assets/play-icon-512.png` — upload in Play Console → Store
> listing) match. NOTE: a launcher icon is a STATIC resource — Android has
> no supported way to recolor it at runtime on events (activity-alias swaps
> break home-screen placement), so the arcs are amber always and the
> NOTIFICATION BADGE is the "something happened" signal.
>
> **Hands-off releases (one-time setup):** Play Console → Setup → API
> access → create a service account → grant it **Release manager** on
> com.hammertrack.app → download its JSON key → add it as the
> `PLAY_SERVICE_ACCOUNT_JSON` Actions secret. From then on the
> android-release workflow uploads straight to production; until then it
> produces the signed AAB artifact to upload by hand.

## Architecture (decided)

**Capacitor thin shell around the live web app.** The native app loads
`https://hammertrack.ai/map` directly (`capacitor.config.ts` → `server.url`)
and appends `HammerTrackApp/1` to its user agent. The entry is /map, not the
marketing root — Brian's screen 1 after installing was the hero page with a
hamburger and "Start free pilot" (Aug 28). Builds installed before v1.2 still
point at the root, so `app/AppEntryRedirect.tsx` sends any Capacitor shell
that lands there to /map client-side — that layer reaches already-installed
apps on the next web deploy, no store release needed.

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
2. Add **camera** for receipt capture (native-only). Location stays
   **foreground only** by decision — Android deliberately does not request
   `ACCESS_BACKGROUND_LOCATION` (top note). Whether iOS ever adds background
   location is a separate, future per-platform decision, not a planned
   mitigation.
3. In App Review notes, lead with the native capabilities + demo login.
If rejected anyway: appeal with the native feature list; worst case we bundle
more UI into the shell. Android has no equivalent rule — Play will approve
the wrapper as-is.

## Account checklist (Brian — in this order)

1. **D-U-N-S number** — ✅ LANDED early Aug 2026 (D&B account created Jul
   31; number confirmed Aug 8). Never file again — duplicate records are slow
   to merge. The dnb.com record must read HAMMERTRACK LLC + the Greenville
   address verbatim; Apple matches it literally.
2. **Apple Developer Program** — 🔴 BLOCKED (Aug 31). Enrollment
   N37H75H2FX, case 20000149520723. Apple cannot verify Brian's identity nor
   his association with HAMMERTRACK LLC. Upload at
   developer.apple.com/contact/file-upload: (1) driver's license, front AND
   back; (2) employment/ownership verification; (3) an LLC formation
   document — SC Articles of Organization / Certificate of Formation (a
   business license is also accepted). Case replies land on
   Brian’s personal inbox (the Aug 27 ones went to brian@hammertrack.ai —
   watch both). The $99/yr is charged on approval.
3. **Google Play Console** — ✅ DONE. Organization account; identity +
   website ownership verified Aug 9; `com.hammertrack.app` live in
   Production since Aug 21 (update Aug 27; v1.2 built Sep 1, upload
   pending). Org accounts skip the 12-tester/14-day closed-testing rule.
   **Sep 30 2026 check:** Google requires every Play app to be registered
   for Android developer verification by then — >99% were auto-registered;
   confirm the package reads "registered" on the Play Console home page
   rather than assuming.
4. **Firebase project** — ✅ DONE (project hammertrack-app, FCM v1 sender;
   `FCM_SERVICE_ACCOUNT` in Vercel; Android push end-to-end since Aug 9).

Still to hand over once Apple clears: Apple team ID + an App Store Connect
invite, and the 3 ASC_* secrets that arm the TestFlight lane.

## Build + submit

- **Android — the `android-release` workflow does it** (proven Sep 1 2026,
  v1.2): bump `versionCode` / `versionName` in `android/app/build.gradle`
  (Play rejects a REUSED versionCode; skipped numbers are free — when in
  doubt, jump higher), dispatch the workflow on master → it runs `cap sync`,
  signs the AAB from the 4 `ANDROID_*` secrets, and — with
  `PLAY_SERVICE_ACCOUNT_JSON` set — uploads straight to the production
  track; without it the signed AAB is the artifact to upload by hand in Play
  Console → Production → Create release. Release rule (Brian, Aug 31):
  always release, no permission needed. Keep the signing keystore backed up
  (losing it = losing the app listing). Android Studio is for local
  debugging only.
- **Icons/splash:** regenerated Aug 30 at every density from the navy/amber
  mark (`store-assets/play-icon-512.png` is the Play 512).
- **iOS:** `ios/App/fastlane/Fastfile` (produce → certs → build →
  TestFlight) arms with the 3 ASC_* secrets on enrollment-approval day;
  nothing to do until Apple clears. Xcode only for local debugging.

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
1. **Push notifications** — ✅ DONE for Android (FCM v1, Aug 9 — theft alerts
   to the lock screen). iOS push (APNs) waits on Apple enrollment.
2. **Location** — foreground "while using the app" ships in v1.2 (Android).
   Background location is deliberately NOT requested on Android; iOS is a
   separate decision at submission time.
3. **Camera** — receipt-chase capture flow
4. **BLE scanning** — every crew phone becomes a roaming tool-tag gateway

## Timeline (actuals)
- Jul 31: D-U-N-S requested · early Aug: landed.
- Aug 9: Apple enrollment + Play org account filed; Play verified identity +
  website the same day.
- Aug 21: **Android LIVE in Play Production — 12 days after enrollment.**
- Aug 27: Play update published · Aug 31: Apple, 3+ weeks in, asks for
  identity + LLC documents — blocked until Brian uploads them.
- Sep 1: v1.2 built by the release workflow; Play upload pending.
- The old estimate ("live in 2–3 weeks, gated by account approvals") held
  for Google and missed for Apple — Apple's organization verification is the
  long pole, not store review.

## Shipping a new Android build (the icon lesson, Aug 31 2026)

Brian uninstalled and reinstalled from Play and got the OLD icon back. That
is correct behaviour and worth understanding, because it will happen again:

**The Capacitor shell loads hammertrack.ai remotely, so a web deploy changes
the app's CONTENT instantly — but never its icon, name, splash or
permissions.** Those are native resources compiled into the bundle. Anything
under `android/` reaches a phone only through a new Play release. Reinstalling
just re-downloads the build that is already published.

The store carries at least versionCode 1 (published 21 Aug) and possibly
more — the console has builds this repo never saw. The new launcher icons
landed in the repo on 30 Aug, which is AFTER those uploads, so no published
build contains them.

**Order of operations:**

1. **Bump `versionCode`** in `android/app/build.gradle` — Play rejects an
   upload whose versionCode already exists. Do NOT assume the repo's number
   matches the console's: builds have been uploaded that this repo never
   recorded, which is why it jumped straight to 5 rather than 2. When in
   doubt, read the highest versionCode in Play Console → Production →
   Releases and go above it; skipped numbers cost nothing.
2. **Check the four signing secrets exist** in GitHub → Settings → Secrets →
   Actions: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The workflow guards on the
   first and fails fast with a pointer if it is missing. Values are in the
   password manager — never in the repo.
3. **Run the `android-release` workflow** (Actions → android-release → Run
   workflow). Manual dispatch only — and since Brian's Aug 31 release rule,
   Claude dispatches it without asking once native-affecting changes merge.
   With the optional `PLAY_SERVICE_ACCOUNT_JSON` secret set, steps 4–5 below
   happen inside the workflow.
4. **Download the signed AAB artifact** from that run.
5. **Play Console → Production → Create new release**, upload the AAB, add
   release notes, roll out.
6. **Separately, the STORE LISTING icon** (`store-assets/play-icon-512.png`)
   is a console upload under Store presence → Main store listing → App icon.
   It needs no build, and it is a different image from the launcher icon —
   updating one does not update the other.

Both icons have to be done, through both doors, or the app looks new in the
store and old on the home screen.
