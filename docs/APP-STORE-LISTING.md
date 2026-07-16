# App Store & Play Store Listing Pack — HammerTrack

*Ready to paste when the Apple Developer / Google Play accounts open (gated on
the D-U-N-S number). Reviewer-notes + privacy answers included — those are what
actually stall a first submission.*

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
> **Stop losing iron to theft.** Get a push the second a machine leaves a job
> site after hours — "Your excavator just left at 2 AM." Draw a geofence around
> any yard or site and know the moment something crosses it.
>
> **Built for the field:**
> • Live map of your whole fleet — trucks, equipment, trailers, tools
> • After-hours theft & left-site alerts to your phone's lock screen
> • Bluetooth tool tags — see which truck your laser level is in
> • Job-site hours & cost tracking — turn location into job costs
> • Maintenance reminders by engine hours, mileage, or date
> • Trip history & daily site logs
> • QuickBooks-ready job costing
>
> **Priced for contractors, not corporations** — a fraction of what the big
> enterprise platforms charge, with no per-site setup fees.
>
> Built by a construction company, for construction companies.

## What's New (v1.0)
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
| Precise location (incl. background) | Yes | Show fleet on the map; geofence alerts. Only while Go Live is on. |
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
alerts, background location for the optional crew-tracker ("Go Live"), and
camera for asset/receipt photos.

Demo account (full access, seeded data):
  email:    <CREATE A REVIEW LOGIN>
  password: <…>

Background location is user-initiated (Go Live toggle) and disclosed in-app and
in the privacy policy (https://hammertrack.ai/privacy). It is used only to show
the fleet on the company map — never for advertising, never sold.
```

---

## Assets checklist (make these)

- **App icon** — 1024×1024 PNG (no alpha for iOS). The HammerTrack mark on navy.
- **iOS screenshots** — 6.7" (1290×2796) and 6.5"; 3–5 shots: live map, theft
  alert, asset panel, tool "on board", job-cost/zone page.
- **Android screenshots** — phone (min 2), same set; plus a 1024×500 feature graphic.
- **Short demo video** (optional, helps 4.2): 15–20s of the live map + a theft push.

## Pre-submission gaps to close (real to-dos)
1. **In-app "Delete my account"** — Apple 5.1.1(v) requires an in-app deletion
   entry point for account-based apps. Add a button in Settings.
2. **Firebase project + `FCM_SERVER_KEY`** in Vercel — turns on the push that
   the listing/4.2 story leans on.
3. **A dedicated review login** with seeded data (don't hand over a real one).
4. Confirm the app loads `https://hammertrack.ai` (add the domain to Vercel —
   still on the old Netlify per the go-live checklist).
