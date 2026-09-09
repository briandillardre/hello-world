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
  registers it). It records through a location FOREGROUND service on plain
  "While using the app" permission — the manifest declares NO
  `ACCESS_BACKGROUND_LOCATION` (so no Play declaration review), only
  `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` (the plugin's own
  manifest has them too). iOS: `NSLocationAlwaysAndWhenInUseUsageDescription`
  + `UIBackgroundModes: location`.
- `android.useLegacyBridge: true` in capacitor.config.ts — the plugin's
  updates halt after ~5 min in the background without it. Fix batches leave
  via CapacitorHttp when the shell has it (WebView HTTP is throttled in the
  background); the queue and the watcher id persist in localStorage across
  page reloads (a reload orphans the native watcher otherwise).
- **v1.4.1 = versionCode 10, dispatched to production.** 1.4.0 (versionCode
  9) went to the internal track and is superseded.
- Already-installed apps (≤ 1.3.1) get everything else on the next web
  deploy: mandatory clock-in fix, foreground shift tracking, /timecards.

## Hardening (sec-check on the ship, Sep 9)
- `/api/clock/fix` needs the `clock` view level AND an open shift (409
  otherwise — the tracker stops itself), caps a phone at 240 fixes/hour
  (429) and drops fixes closer than 10 s.
- Clock-in without a location is refused server-side too.
- CSV cells starting with `= + - @` or a tab are apostrophe-prefixed (Excel
  formula injection through a member's display name).
- Ask AI's `time_cards` honours the `clock` view level and the page's scope
  (crew see their own; Foreman+ the crew's); the Agent Interface (company
  key = admin-grade) stays company-wide.
- Manager corrections use the EFFECTIVE permissions (a view-as preview is
  read-only) and freeze both original times on the first edit.

## Known gaps / next
- Breaks are entered by a manager, not tracked by the crew (a Break button
  is the natural next step).
- Overtime is weekly-only; a state with daily OT needs a company setting.
- Clock-in reminders (push at the usual start time) — no schedule data yet.
- ~~RLS on `time_entries` was company-wide FOR ALL (015)~~ — **migration 104**
  (sec-check P1 follow-up, same night): SELECT stays company-wide, INSERT and
  UPDATE only your own rows, no client DELETE, and a BEFORE UPDATE guard
  (`guard_time_entry_cols`) lets a session only CLOSE its own open entry —
  every other column (hours, break, the edit trail) is server-side.
  `daily_logs` gets the same treatment under task #60.
