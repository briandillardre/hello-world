# Time clock v2 — mandatory shift tracking + GPS-verified time cards

Shipped Sep 9 2026. Brian: "clock in also a must and mandatory tracking thru
app while clocked in … native background tracking is a must." The bar is
Workyard's ad: "GPS-verified time cards straight to payroll." Everything here
is also shaped as facts for the AI layer (Ask AI + the Agent Interface's
`time_cards` tool) — the end goal is a Claude operating system running the
company off this data.

## What the crew sees
1. **Clock in needs a location.** The Time clock card asks the phone for a
   fix (10 s); without one it refuses with the way to fix it. That fix is
   `time_entries.in_lat/in_lng` (059) and the first point of the shift.
2. **The shift is recorded until clock-out.** `ShiftTracker` (mounted in the
   dashboard shell) polls `/api/clock/state` (on load, every minute, on the
   `ht:clock` event the clock card fires, on foreground) and, while a shift
   is open, records fixes to `/api/clock/fix` → `pushPhoneLocation` → the
   person's `phone-<uid>` asset (the same asset Share location uses).
   Cadence: one fix per 30 s, or after a 40 m move (≥ 10 s apart). Fixes
   queue in memory through dead zones (≤ 200) and flush in batches of 50
   with their own timestamps (server clamps to [now − 24 h, now]).
   - Native shell **with** `@capacitor-community/background-geolocation`
     (v1.4.0+): a location foreground service — keeps recording with the
     screen off. Play's prominent-disclosure sheet appears once before the
     OS prompt (`ht_shift_disclosure_done`); "Not now" = the amber bar.
   - Anything else (browser, PWA, older app): `watchPosition` while the
     page is open. Honest: foreground only.
   - Denied location while clocked in → an amber bar on every screen
     ("Location is required while you're clocked in") with Open settings /
     Clock out. It never dismisses on its own. The clock card's status line
     says what the tracker is doing (engine, fixes this session).
3. **Clock out** still goes through the daily log (photos required per the
   company form); the tracker stops on the `ht:clock` event.

## /timecards (view level: `clock`)
- Crew (Associate) see their own card; Foreman and up see the crew's
  (`timecardScope`). The Team or Billing ability edits and pushes.
- One week at a time (Monday–Sunday in the viewer's tz, `?week=YYYY-MM-DD`).
- Per person: paid hours (elapsed − unpaid break) split **regular / OT at
  40 h per week** (FLSA; SC has no daily OT), hours by site, **on the clock
  now**, **GPS-verified %**, flags. Days expand to entries:
  `7:02 AM → 3:41 PM · 8.4 h · Creekside`, `at Creekside → near 12 Oak St,
  Greer` (zone → cached reverse geocode, no network on the render path),
  `312 fixes · 94% on Creekside`, plan, edit trail, flag chips.
- **Flags** (`lib/timecards.ts`): Still clocked in · No GPS (no fixes AND no
  clock-in fix, after 15 min) · Mostly off-site (≥ 5 fixes, < 50 % inside
  the clocked site) · Long shift (> 14 h) · Edited · No job site (project
  category without a zone). Elapsed is capped at 24 h for an entry nobody
  closed.
- **CSV** (`/api/timecards/export?week=`): one row per entry — person, date,
  in, out, break, paid hours, category, site, clocked-in-at, clocked-out-at,
  GPS fixes, on-site %, flags, edited by, edit note, week regular, week OT,
  entry id. Payroll-ready.
- **Push to QuickBooks** per day: the existing `pushQboDayAction`
  (TimeActivity rows, 065) — needs the crew ↔ QBO employee mapping on
  /accounting and a live QBO connection.
- **Corrections** (`adjustTimeEntryAction`): clock-in / clock-out / unpaid
  break / a required note. The first edit copies the recorded times into
  `original_in_at/original_out_at`; `edited_by/edited_at/edit_note` say who
  and why. The page shows "Edited by X — 'note' · recorded 7:02 → open".

## GPS verification (migration 103)
`timecard_gps_stats(uuid[])` — per entry: the person's phone fixes between
clock-in and clock-out (or now, capped at clock-in + 24 h), how many fell
inside the entry's job-site polygon (`ST_Contains(geofences.geometry,
asset_locations.geom)`), first and last fix. One range scan per entry on
`asset_locations(asset_id, timestamp)` (001). Invoker rights — RLS applies.
Called in chunks of 200; a missing function (pre-103 database) = the page
says verification appears once the migration runs, no crash.

`lib/timecards.ts` is pure (no I/O) and shared by the page, the CSV and
the `time_cards` MCP/Ask AI tool, so every surface agrees.

## Native release
- `@capacitor-community/background-geolocation` in package.json (cap sync
  registers it). Android: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`. iOS: `NSLocationAlwaysAndWhenInUseUsageDescription`
  + `UIBackgroundModes: location`.
- **v1.4.0 = versionCode 9.** Dispatched to the **internal** track; Play
  requires the Location-permissions declaration (+ video) before a build
  with background location can roll to production — wording in
  docs/APP-STORE-PLAYBOOK.md "Background location" (board #119, Brian).
- Already-installed apps (≤ 1.3.1) get everything else on the next web
  deploy: mandatory clock-in fix, foreground shift tracking, /timecards.

## Known gaps / next
- Breaks are entered by a manager, not tracked by the crew (a Break button
  is the natural next step).
- Overtime is weekly-only; a state with daily OT needs a company setting.
- Clock-in reminders (push at the usual start time) — no schedule data yet.
- RLS on `time_entries` is still company-wide FOR ALL (015) — task #60
  should narrow writes to own rows + service role alongside daily_logs.
