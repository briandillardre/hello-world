# App Store & Play Store Listing Pack — HammerTrack

*Reviewer-notes + privacy answers included — those are what actually stall a
first submission.*

> **Aug 28 2026 — listing cleanup.** The app has been live in Play Production
> since Aug 21, but the listing was showing RAW BROWSER SCREENSHOTS (URL bar,
> tabs, Android nav buttons visible) and no tagline under the title. Fresh
> assets are in `store-assets/` — 6 captioned phone screenshots per platform
> plus a rebuilt feature graphic, all shot against real satellite imagery
> (the previous set was captured with no map tiles loaded, so the map read as
> a black void). **What to re-upload in Play Console → Store listing:**
> 1. Short description — the field that renders as the italic line under
>    "HammerTrack · Business" in search results. It is currently EMPTY.
> 2. Phone screenshots — replace all with `store-assets/android-phone/*.png`
>    (1080×1920, in filename order).
> 3. Feature graphic — `store-assets/feature-graphic-1024x500.png`.

---

## App identity

- **App name:** HammerTrack
- **Subtitle (App Store, 30 char):** `Fleet & tool GPS tracking`
- **Short description (Play, 80 char):** `Live GPS tracking for construction trucks, equipment, and Bluetooth tools.`
- **Bundle / package id:** `com.hammertrack.app`
- **Primary category:** Business (secondary: Productivity)
- **Support URL:** https://hammertrack.ai
- **Marketing URL:** https://hammertrack.ai
- **Privacy Policy URL:** https://hammertrack.ai/privacy

## Keywords (App Store, 100 char, comma-sep, no spaces)
```
gps,fleet,tracker,construction,equipment,tools,geofence,telematics,theft,obd2,job cost,contractor
```

## Full description (both stores)

> **Know where every truck, machine, and tool is — right now.**
>
> HammerTrack is GPS tracking built for construction crews, not enterprise
> fleets. One live map for your vehicles (OBD-II), heavy equipment (GPS), and
> even your small tools (Bluetooth tags that ride along with whatever truck is
> carrying them).
>
> **Stop losing iron to theft.** Get a push within minutes of a machine leaving a job
> site after hours — "Your excavator just left at 2 AM." Draw a geofence around
> any yard or site and know within minutes when something crosses it.
>
> **Built for the field:**
> • Live map of your whole fleet — trucks, equipment, trailers, tools
> • After-hours theft & left-site alerts to your phone's lock screen
> • Bluetooth tool tags — see which truck your laser level is in
> • Job-site hours & cost tracking — turn location into job costs
> • Replay any day: speed-coloured trails, every stop, every site
> • Maintenance reminders by engine hours, mileage, or date
> • Trip history, daily site logs, and a time clock that knows the job
> • Weekly owner digest and a workday-morning site briefing
> • Set up in minutes — scan a tracker's barcode, or paste your whole
>   fleet in from a spreadsheet
> • Ask it anything about your operation, in plain English
>
> **Priced for contractors, not corporations** — a fraction of what the big
> enterprise platforms charge, with no per-site setup fees.
>
> Built by a construction company, for construction companies.

## What's New

**v1.2 (versionCode 5 — built Sep 1 2026, Play upload pending)**
```
Opens straight to the live map. Asks for your location once — only while
you're using the app — so you show up on the crew map. New navy-and-amber
icon that reads as HammerTrack on the home screen.
```

**v1.0**
```
First release. Live fleet map, theft & geofence alerts, Bluetooth tool
tracking, maintenance reminders, and job-site hours — all on your phone.
```

---

## App Privacy answers (Apple "nutrition label" / Play Data Safety)

Data collected and **linked to the user**, used only for **App Functionality**
(NOT tracking/advertising — answer "No" to "used for tracking"):

| Data type | Collected | Why |
|---|---|---|
| Precise location — **foreground only on Android** ("while using the app"; no `ACCESS_BACKGROUND_LOCATION` is requested). iOS: TBD, decided separately at submission | Yes | Show the user on the crew map + the fleet on the map; geofence alerts. Only while the app is open and Go Live is on. |
| Coarse location | Yes | Same |
| Name / email | Yes | Account |
| Photos | Yes | Asset / receipt photos the user attaches |
| Device ID (push token) | Yes | Deliver alerts to the device |
| Product interaction / diagnostics | Yes | Keep the app working |

- **Sold to third parties?** No.
- **Used for tracking/advertising?** No.
- **Data encrypted in transit?** Yes.
- **Can users request deletion?** Yes (in-app + email).

## App Review notes (paste into Apple's "Notes")
```
HammerTrack is a B2B fleet-tracking app for construction companies. It wraps
our live web app and adds native capabilities: push notifications for theft
alerts, foreground location for the live map and the optional crew-tracker
("Go Live", while the app is open), and camera for asset/receipt photos.

Demo account (full access, seeded fleet + a week of history):
  email:    review@hammertrack.ai
  password: <set when running supabase/seed_review_account.sql — see below>

Suggested tour: Live Map (fleet + zone), tap the F-350 for its panel, Zones ->
Riverside Office Park for tracked hours/costs and the activity chart,
Settings -> "Delete my account" for the account-deletion entry point.

Location is foreground-only: the app asks for "while using the app" location
after an in-app explainer, and Go Live is a user-initiated toggle. Both are
disclosed in-app and in the privacy policy (https://hammertrack.ai/privacy).
Location is used only to show the crew and fleet on the company map — never
for advertising, never sold. Customers subscribe on our website; the app does
not sell digital purchases.
```

(Android ships exactly that — no background permission is declared. Whether
iOS adds background location is a separate, later decision; do not claim it
in any store form until it is built.)

**Review-account setup (one-time, before first submission):** Supabase
dashboard → Auth → Add user `review@hammertrack.ai` (auto-confirm, password to
the password manager) → SQL Editor → run `supabase/seed_review_account.sql`.
Rerunnable — it rebuilds the seeded company from scratch.

---

## Assets checklist (make these)

- **App icon** — 1024×1024 PNG (no alpha for iOS). The HammerTrack mark on navy.
- **iOS screenshots** — 6.7" (1290×2796) and 6.5"; 3–5 shots: live map, theft
  alert, asset panel, tool "on board", job-cost/zone page.
- **Android screenshots** — phone (min 2), same set; plus a 1024×500 feature graphic.
- **Short demo video** (optional, helps 4.2): 15–20s of the live map + a theft push.

## Status (Sep 1 2026)

**Android: LIVE.** `com.hammertrack.app` has been in Play Production since
Aug 21 (org account). v1.2 (versionCode 5) was built by the android-release
workflow on Sep 1 (run 4, green) — awaiting Brian's Play Console upload, or
hands-off once `PLAY_SERVICE_ACCOUNT_JSON` is added as a GitHub secret. The
listing re-upload (screenshots, tagline, feature graphic — top of this doc)
is still pending. Google's Sep 30 2026 Android developer-verification
deadline: confirm the package shows "registered" on the Play Console home
page. **iOS: BLOCKED** on Apple's Aug 31 request for identity + LLC documents
— see docs/APP-STORE-PLAYBOOK.md.

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
7. ~~iOS build lane~~ ✅ WRITTEN — ios/App/fastlane/Fastfile (produce →
   certs → build → TestFlight), arms with the 3 ASC_* secrets on
   enrollment-approval day. **Blocked on Apple's Aug 31 document request.**
8. Screenshots + feature graphic — in `store-assets/`; the Play Console
   re-upload is still pending (listing shows raw browser screenshots and no
   tagline until Brian does it).
