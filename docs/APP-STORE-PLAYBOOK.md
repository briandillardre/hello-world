# App Store Playbook — HammerTrack iOS + Android

*Created Jul 15, 2026 — the day the LLC + EIN unlocked store accounts.*

> **Status Sep 1 2026 — Android v1.2 (versionCode 5) is BUILT, upload
> pending.** The android-release workflow produced the signed AAB on Sep 1
> (run 4, green). It carries the LOCATION permissions, the new launcher
> icons and the /map entry described below. Brian uploads it in Play Console
> → Production → Create release — or adds the `PLAY_SERVICE_ACCOUNT_JSON`
> secret (setup below) and the workflow uploads by itself from then on.
> Android has been live in Play Production since Aug 21 (hands-off uploads
> proven Sep 3; 1.4.1 waits on the Play Foreground-service declaration, board
> #119). **iOS waits on Brian's INDIVIDUAL Apple enrollment** — the LLC's
> organization enrollment was denied as final on Sep 4 — and everything on
> our side is ready for approval day (readiness pass Sep 10; runbook below).
>
> **v1.2 carries the LOCATION permissions (Aug 30).**
> `AndroidManifest.xml` now declares `ACCESS_COARSE_LOCATION` +
> `ACCESS_FINE_LOCATION` (still the only location permissions: since Sep 9
> the shift recorder runs as a location FOREGROUND service, which needs no
> background-location permission — see *Background location* below). Until
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
Apple sometimes rejects pure web wrappers. What makes this shell more than a
website — and what the App Review notes lead with (docs/APP-STORE-LISTING.md):
1. **Push notifications** — theft alerts to the lock screen (the APNs key in
   Firebase is the one-day task after the first TestFlight build).
2. **Background location** — the clocked-in shift recorder keeps recording
   with the screen off (`UIBackgroundModes: location`; the when-in-use and
   always strings are in Info.plist). Requested at point of use, after the
   in-app explainer; stops at clock-out.
3. **Camera** — barcode scanning of tracker labels, job photos, receipts.
4. **Bluetooth** — the phone is a roaming tool-tag gateway while the Tag
   scanner is open.
5. A native launch screen, the app opens straight on /map (never the
   marketing site), in-app account deletion, a reviewer demo account.

Other review rules already met: **4.8 Login Services** — inside the shell the
only sign-in is our own email + password (Google is hidden there since Sep 10:
Google refuses OAuth from embedded web views anyway, so the button was a dead
end), which means Sign in with Apple is NOT required; adding it is one env var
once the provider is configured (`NEXT_PUBLIC_AUTH_APPLE=1`, Approval day
step 6). **5.1.1(v) account deletion** — Settings → Delete my account and
/delete-account. **Export compliance** — `ITSAppUsesNonExemptEncryption =
false` in Info.plist (HTTPS only), so no per-build questionnaire.

If rejected anyway: appeal with the native feature list; worst case we bundle
more UI into the shell. Android has no equivalent rule — Play approved the
wrapper as-is.

## Account checklist (Brian — in this order)

1. **D-U-N-S number** — ✅ LANDED early Aug 2026 (D&B account created Jul
   31; number confirmed Aug 8). Never file again — duplicate records are slow
   to merge. The dnb.com record must read HAMMERTRACK LLC + the Greenville
   address verbatim; Apple matches it literally.
2. **Apple Developer Program** — 🔴 ORGANIZATION enrollment DENIED as final
   (phone, Sep 4; enrollment N37H75H2FX, case 20000149520723 — Apple would
   not say what failed). **Route now: INDIVIDUAL** (board #41): Apple
   Developer app on the iPhone → Account → Enroll → Individual → driver's
   license scan + selfie → $99/yr on the Mercury card. No D-U-N-S, no LLC
   papers; usually approved within a day or two. The App Store seller name
   reads "Brian Dillard" until Apple converts the account to an Organization
   later on request (the D&B record must match HAMMERTRACK LLC verbatim).
   **Sep 10: SUBMITTED** — on the PC (web), under a NEW Apple ID,
   brian@dillardconstructiongroup.com. The org enrollment still reads "In
   Review" in the Apple Developer app, so brian@hammertrack.ai could not
   start a second enrollment (one Apple ID holds one enrollment) and the
   iPad app route failed no matter what. The welcome email goes to the DCG
   inbox; an identity-verification email first is normal. Sign in to App
   Store Connect with the DCG Apple ID; invite brian@hammertrack.ai as a
   user afterwards. Then: **Approval day** below.
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

Still to hand over once Apple clears: the four `ASC_*` secrets (Approval day
below).

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
- **iOS — the `ios-testflight` workflow does it** (GitHub macOS runner, no
  Mac): `ios/App/fastlane/Fastfile` registers the app, gets a distribution
  certificate + App Store profile through the API key, pins them on the
  target (the Capacitor project is automatic-signing/no-team, which cannot
  archive headless), builds and uploads to TestFlight. Four `ASC_*` secrets
  arm it (Approval day). Build number = the run number; the `version` input
  sets the marketing version (the project carries 1.4.1, matching Android).
  Xcode only for local debugging.

## Approval day (iOS) — Brian's part is ~15 minutes, then one dispatch

Readiness pass done Sep 10: workflow, lane, signing, versions (1.4.1),
permission strings, export-compliance key, icon, review notes, demo account,
in-app login fixed for the shell (Google hidden). Nothing else waits on code.

1. **API key** — App Store Connect → Users and Access → Integrations → App
   Store Connect API → Team Keys → Generate. Name `github-ci`, role
   **Admin** (Developer cannot create signing certificates). Download the
   `.p8` — a ONE-TIME download, keep it in the password manager. Note the
   **Key ID** and the **Issuer ID** shown on that page.
2. **Team ID** — developer.apple.com/account → Membership details (10 chars).
3. **Four GitHub secrets** — repo → Settings → Secrets and variables →
   Actions: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (paste the whole
   .p8 file including the BEGIN/END lines), `ASC_TEAM_ID`.
4. Say "apple secrets are in" → Claude dispatches `ios-testflight` (or
   Actions → ios-testflight → Run workflow, version `1.4.1`). ~15–25 min
   later the build is processing in TestFlight; add Brian's Apple ID as an
   internal tester (App Store Connect → TestFlight → Internal Testing) and
   install through the TestFlight app.
5. **App Store Connect listing** (fill while the build processes): name
   HammerTrack, subtitle, keywords, description, screenshots from
   `store-assets/ios-6.7` + `ios-12.9`, privacy policy URL, support URL,
   **App Privacy** answers and **App Review notes** verbatim from
   docs/APP-STORE-LISTING.md; run `supabase/seed_review_account.sql` and put
   the review account's password in the notes. Age rating 4+, Business.
6. Optional, same day — **Sign in with Apple**: Certificates, Identifiers &
   Profiles → Identifiers → the App ID → enable Sign in with Apple; a new
   Services ID (`com.hammertrack.app.web`, return URL
   `https://<supabase-project-ref>.supabase.co/auth/v1/callback`); Keys →
   new key with Sign in with Apple; Supabase → Authentication → Providers →
   Apple (Services ID, Team ID, Key ID, .p8); then `NEXT_PUBLIC_AUTH_APPLE=1`
   in Vercel + redeploy. The button appears on /login, /register and /join.
7. **Before the third iOS build — certificates.** The runner's keychain is
   thrown away, so without match the lane mints a new Apple Distribution
   certificate every run and Apple caps them at a couple per team. Create a
   PRIVATE repo `hammertrack-certs` (empty), a fine-grained PAT with Contents
   read/write on it, and three secrets: `MATCH_GIT_URL`
   (`https://github.com/briandillardre/hammertrack-certs.git`),
   `MATCH_GIT_BASIC_AUTHORIZATION` (base64 of `briandillardre:<PAT>`),
   `MATCH_PASSWORD` (any strong passphrase — it encrypts the repo). The lane
   switches to match by itself. If a build fails with "maximum number of
   certificates" before that: revoke the old Apple Distribution certificates
   at developer.apple.com → Certificates and re-run.
8. **iOS push** after the first TestFlight build: upload an APNs auth key to
   Firebase (project hammertrack-app) so FCM delivers to iOS tokens — the
   one-day task noted in the listing doc.

## Store listing prep (can be done anytime)
- Name: **HammerTrack** · subtitle: "Know where everything is"
- Privacy policy URL: hammertrack.ai/privacy ✓ (already live)
- Support URL: hammertrack.ai/contact ✓
- Screenshots: live map w/ fleet, theft alert, tools-aboard panel, timeline
  replay, clock-in — phone-frame captures at required sizes
- App Privacy questionnaire: collects location (app functionality — fleet +
  crew tracking, linked to account), contact info (account), photos (receipts,
  user-initiated). No ads, no tracking-for-advertising.

## Background location — the shift recorder (v1.4.0 → 1.4.1, Sep 9 2026)

Brian: "mandatory tracking thru app while clocked in … native background
tracking is a must." The shell carries
`@capacitor-community/background-geolocation`: while a person is CLOCKED IN,
`components/field/ShiftTracker.tsx` starts a **location foreground service**
(persistent notification "HammerTrack · on the clock") so the shift keeps
recording with the screen off; clocking out stops it. Nothing runs when
nobody is clocked in.

**Permission model (corrected by ship-check the same night):** a location-type
foreground service started while the app is in use may keep receiving
location in the background with plain **"While using the app"** permission.
The plugin never requests `ACCESS_BACKGROUND_LOCATION`, and the manifest
does NOT declare it (v1.4.0 briefly did — removed in 1.4.1) — so **Play's
background-location declaration + video review does not apply.** The
in-app disclosure sheet (before the OS prompt) stays: it is the honest thing
to do and what Play's prominent-disclosure rule asks for when location is
collected while the app is not on screen.

**Two settings the plugin needs, both in 1.4.1:** `android.useLegacyBridge:
true` in capacitor.config.ts (updates halt after ~5 min in the background on
the modern bridge — plugin issue #89), and the fix batches leave through
`CapacitorHttp` when the shell has it (Android throttles WebView HTTP after
~5 min in the background — issue #14); the queue is persisted in
localStorage across page reloads, and the watcher id is persisted so a
watcher orphaned by a reload is removed before a new one starts.

Release: **1.4.1 = versionCode 10** was dispatched to **production** by the
android-release workflow (run #9, Sep 9 03:23 UTC). The AAB built and
uploaded, but Play refused to commit the release:

> *You must let us know whether your app uses any Foreground Service permissions.*

That is the **Foreground service permissions declaration** (Android 14+ /
targetSdk 34): the plugin's manifest declares `FOREGROUND_SERVICE_LOCATION`,
and Play wants a one-time form per foreground-service type — much lighter
than the background-location review, but a form Brian has to fill (board
#119). Play Console → **App content** → *Foreground service permissions* (it
also appears in the release error's link) → for type **Location**:

- *Describe the user-facing feature that uses this foreground service:*
  While an employee is clocked in on HammerTrack's time clock, the app
  records the phone's location to the employee's time card (GPS-verified
  hours for payroll) and shows the employee on their company's crew map.
  The service starts at clock-in, runs only until clock-out, and shows a
  persistent notification ("HammerTrack · on the clock") the whole time.
- *Video:* a 30–60 s screen recording on the installed app: Time clock →
  Clock in → the location disclosure sheet → Continue → the OS prompt
  ("While using the app") → background the app → the persistent
  notification → Clock out → the notification disappears.

**Why the form was not there (Sep 12).** Brian went to App content and found
ten actioned declarations, none of them Foreground service permissions, and
"Need attention" empty. A Play edit is ATOMIC: run #9's log reads *Creating a
new Edit → Uploading → Successfully uploaded 1 artifacts → Committing the Edit
→ error*. Because the COMMIT failed, the whole edit was thrown away, bundle
included — so Play has never processed a build declaring
`FOREGROUND_SERVICE_LOCATION`, and it only shows the declaration once such a
build is sitting in the console. The declaration and the release were each
waiting on the other.

Broken by `status: draft` on the release workflow (a new input): the edit
commits, nothing is published, the build parks in the console as a draft
production release, and the form appears under App content. Fill it, then
**start the rollout on that draft** — same build, same versionCode 10, no
rebuild needed. (Only if the draft is discarded does a re-dispatch need a
fresh versionCode.)

Then re-run `android-release` with `track: production` — nothing in the
repo needs to change (the same versionCode 10 AAB is fine, Play never
accepted it). 1.4.0 (versionCode 9) went nowhere and is superseded.

## Native roadmap after v1
1. **Push notifications** — ✅ DONE for Android (FCM v1, Aug 9 — theft alerts
   to the lock screen). iOS push (APNs) waits on Apple enrollment.
2. **Location** — foreground "while using the app" shipped in v1.2 (Android).
   **The shift recorder shipped in v1.4.x (Sep 9)** — a location foreground
   service, no background-location permission, no Play declaration (see
   *Background location* above). iOS: `NSLocationAlwaysAndWhenInUseUsageDescription`
   + `UIBackgroundModes: location` are in Info.plist for the day Apple
   enrollment clears.
3. **Camera** — receipt-chase capture flow
4. **BLE scanning** — every crew phone becomes a roaming tool-tag gateway — **shipped Sep 9 (foreground), on by default Sep 12:** the gateway runs on every screen of the app (duty-cycled 10 s of each 20 s window, a fix only when a tag is heard), behind a one-time in-app card that explains it before the OS Bluetooth prompt. No new Play declaration: the scan runs in the app, not in a foreground service — only adding an FGS for it (type `connectedDevice`) would need a second declaration. The native background piece stays on this list.

## Timeline (actuals)
- Jul 31: D-U-N-S requested · early Aug: landed.
- Aug 9: Apple enrollment + Play org account filed; Play verified identity +
  website the same day.
- Aug 21: **Android LIVE in Play Production — 12 days after enrollment.**
- Aug 27: Play update published · Aug 31: Apple, 3+ weeks in, asks for
  identity + LLC documents — blocked until Brian uploads them.
- Sep 1: v1.2 built by the release workflow; Play upload pending.
- Sep 4: Apple denies the ORGANIZATION enrollment as final (phone). Route
  changes to Individual (board #41).
- Sep 10: iOS ready-for-approval-day pass — workflow, signing, versions,
  review rules; only the enrollment remains.
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
