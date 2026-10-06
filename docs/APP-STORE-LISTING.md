# App Store & Play Store Listing — HammerTrack

**The listing is code (Oct 4 2026 — Brian: "make sure our Google Play listing
and apple listing in the future has accurate descriptions and screenshots
videos").** The Aug 28 pack sat in the repo for five weeks waiting on a manual
Play Console re-upload while the app kept changing under it (its feature
graphic still said "built for construction crews"; its alert screenshot said
"Left job site"). Now nobody re-uploads anything by hand:

| What | Where | How it reaches the store |
|---|---|---|
| Every word — Play title (30), short (80) and full (4000) description, YouTube promo link; App Store name, subtitle, promotional text, keywords, release notes, URLs | `store-assets/listing.json` (limits checked by both scripts) | Play: `play-listing` workflow. Apple: `node scripts/store-meta.mjs` → fastlane `deliver` |
| 8 captioned screenshots per device — Play phone 1080×1920, App Store iPhone 6.9" 1320×2868, iPad 13" 2064×2752 (also Play's 10-inch tablet set) + the 1024×500 feature graphic | `store-assets/android-phone/`, `ios-6.9/`, `ios-ipad-13/`, `feature-graphic-1024x500.png` — made by `scripts/store-shots.mjs` from the REAL app in demo mode (it refuses to run against a real company, so no customer fleet or name is ever in a store image); captions come from `listing.json → shots` | Same two doors |
| Promo video | `scripts/store-video.mjs` records ~75 s of the same demo app at 1920×1080 (WebM), the screenshots' own captions as title cards between scenes — not committed, it is made again on demand. Play takes only a YouTube link → `listing.json → play.video` | Brian uploads the file to YouTube (Unlisted works); the link goes in listing.json, then the `play-listing` workflow. Apple's app previews are a separate format (device-sized, ≤ 30 s) — made when the iPhone app ships |

**Changing the listing:** edit `listing.json` (and the shot captions there) →
`npm run build && PORT=3313 npm start` with NO Supabase env (demo mode) →
`node scripts/store-shots.mjs` (`--reuse` re-frames the last captures for a
caption change; behind a TLS-intercepting proxy set `STORE_SHOTS_CA`) →
`node scripts/store-video.mjs` when a caption or a screen in it changed →
commit → run the **`play-listing`** workflow (validate only by default; tick
*commit* to publish — Play reviews listing changes, usually within hours).
**One-time prerequisite (board #191):** the service account in
`PLAY_SERVICE_ACCOUNT_JSON` publishes releases but needs Play Console → Users
and permissions → that account → App permissions → HammerTrack → *Edit store
listing, pricing and distribution*. Without it Play accepts the uploads into
the edit and then refuses to validate it (403) — the Oct 4 first run.
Releases and tracks are never touched by it. Run truth-check on any copy
change: the splash truth rule applies to the store exactly as to the splash —
nothing waiting on a vendor (no texts until a Twilio number is verified, no
QuickBooks until the QBO app exists), no prices, no competitor names, field
fleets not only construction, no person's name.

## App Privacy answers (Apple "nutrition label" / Play Data Safety)

Data collected and **linked to the user**, used only for **App Functionality**
(NOT tracking/advertising — answer "No" to "used for tracking"):

| Data type | Collected | Why |
|---|---|---|
| Precise location | Yes | Show the user on the crew map + the fleet on the map; geofence alerts. **While clocked in** the phone's location is recorded to the person's time card in the background (iOS `UIBackgroundModes location`; Android a location foreground service — both on "while using the app" permission, recording starts at clock-in and stops at clock-out, disclosed in-app first). While the app is open it also listens for the company's Bluetooth tool tags and, on hearing one, sends the phone's location to place it — off the clock only a non-identifying ~250 m area is kept for a company tag and nothing for any other tag. A clocked-in person's phone riding alone in a company truck counts that truck's driving toward their driver safety score. Otherwise only while the app is open and Go Live is on. |
| Coarse location | Yes | Same |
| Name / email | Yes | Account |
| Photos | Yes | Job, asset and receipt photos the user takes or attaches (job photos keep where they were taken); a clock-in/out photo only when the company requires one, deleted after 90 days |
| Device ID (push token) | Yes | Deliver alerts to the device |
| Product interaction / diagnostics | Yes | Keep the app working |

- **Sold to third parties?** No.
- **Used for tracking/advertising?** No.
- **Data encrypted in transit?** Yes.
- **Can users request deletion?** Yes (in-app + email).

## App Review notes (paste into Apple's "Notes")
```
HammerTrack is a B2B fleet-tracking app for construction, landscaping and other field-service companies. It wraps
our live web app and adds native capabilities: push notifications for theft
alerts; location for the live crew map and for GPS-verified time cards (while
an employee is clocked in the app records the phone's location in the
background — location background mode — and stops at clock-out); the camera
for barcode scanning of tracker labels and for job/receipt photos; and
Bluetooth scanning that turns the phone into a gateway for our tool tags.

Demo account (full access, seeded fleet + a week of history):
  email:    review@hammertrack.ai
  password: <set when running supabase/seed_review_account.sql — see below>

Suggested tour: Live Map (fleet + zone), tap the F-350 for its panel, Zones ->
Riverside Office Park for tracked hours/costs and the activity chart, More ->
Time clock -> Clock in (the location prompt follows an in-app explainer; the
shift is recorded until Clock out), Settings -> "Delete my account" for the
account-deletion entry point.

Location is requested at point of use after an in-app explainer; Go Live and
clock-in are user-initiated. Both are disclosed in-app and in the privacy
policy (https://hammertrack.ai/privacy). Location is used only to show the
crew and fleet on the company map, to verify time cards, to place the
company's Bluetooth tool tags the phone hears (off the clock only a rough,
non-identifying area is kept) and to count a clocked-in driver's trips in a
company truck toward their driver safety score — never for advertising,
never sold. Sign-in inside the app is our own email + password
(no third-party login service is offered in the app). Customers subscribe on
our website; the app does not sell digital purchases.
```

(Both platforms ship exactly that since 1.4.x: Android records through a
location foreground service on "while using the app" permission — no
`ACCESS_BACKGROUND_LOCATION` — and iOS through the location background mode.
Claim nothing beyond it.)

**Review-account setup (one-time, before first submission):** Supabase
dashboard → Auth → Add user `review@hammertrack.ai` (auto-confirm, password to
the password manager) → SQL Editor → run `supabase/seed_review_account.sql`.
Rerunnable — it rebuilds the seeded company from scratch.

---

## Status (Oct 4 2026)

**Android: LIVE.** `com.hammertrack.app` has been in Play Production since
Aug 21 (org account); hands-off uploads from the android-release workflow are
proven (Sep 3). 1.4.1 (versionCode 10, the shift recorder) is the live build;
1.5.0–1.5.4 sit as drafts behind the one-time Photo and Video declaration
(board #140) and `play-promote` rolls the newest out once it is filed. The
new listing (words, screenshots, feature graphic — top of this doc) is ready
and waits on board #191 to publish. Developer verification: registered
(Sep 26). **iOS: waiting on
Brian's INDIVIDUAL Apple enrollment** (the organization enrollment was denied
as final Sep 4); everything else is ready — docs/APP-STORE-PLAYBOOK.md →
Approval day.

1. ~~In-app "Delete my account"~~ ✅ BUILT — Settings card → files an
   account_deletion_requests row (migration 058) + emails support; complete
   requests within 30 days.
2. ~~Firebase + FCM~~ ✅ DONE — project hammertrack-app, FCM v1 sender,
   @capacitor/push-notifications synced into both shells. Android push is
   end-to-end. **iOS push note:** the Capacitor plugin registers APNs tokens;
   our sender speaks FCM — after Apple approval, either upload an APNs auth
   key to Firebase + add the FCM iOS SDK, or teach lib/push.ts APNs HTTP/2
   for tokens with platform='ios'. One-day task, post-TestFlight.
3. ~~Review login~~ ✅ SCRIPTED — `supabase/seed_review_account.sql` (Brian
   runs it + sets the password before first submission).
4. ~~hammertrack.ai on Vercel~~ ✅ DONE Aug 5.
5. ~~App icons~~ ✅ DONE Aug 9 — real mark, every density, both shells.
6. ~~Release signing~~ ✅ DONE — upload keystore generated Aug 9 (in Brian's
   password manager); the 4 ANDROID_* secrets are in place and
   android-release.yml built v1.2 from them on Sep 1 (run 4).
7. ~~iOS build lane~~ ✅ READY (Sep 10) — the `ios-testflight` workflow +
   ios/App/fastlane/Fastfile (register → certificate + profile → manual
   signing → build → TestFlight) arm with four `ASC_*` secrets on approval
   day (playbook → Approval day). **Waiting on the Individual enrollment.**
8. Screenshots + feature graphic — ✅ MADE Oct 4 (`store-assets/` from
   `scripts/store-shots.mjs`); **publishing waits on board #191** — the
   `play-listing` workflow's first run uploaded everything and Play refused
   the commit until the upload account may edit the store listing. Promo
   video: made (`scripts/store-video.mjs`), waits on a YouTube upload.
