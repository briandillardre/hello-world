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
  GPS fixes, on-site %, flags, findings (120), edited by, edit note, week
  regular, week OT, entry id. Payroll-ready.
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
- **v1.4.1 = versionCode 10** — built and uploaded, but Play will not release
  it until the one-time **Foreground service permissions** declaration (FGS
  type location) is answered in the Play Console (board #119, wording in
  docs/APP-STORE-PLAYBOOK.md). Re-dispatch `android-release` afterwards.
  1.4.0 (versionCode 9) went nowhere and is superseded.
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
  `daily_logs` got the same treatment in **migration 105** (read
  company-wide, insert your own, no client update/delete).

## Integrity — buddy punching and ghost shifts (Sep 22 2026, migration 120)
A landscaping prospect forwarded what his office found by reviewing security
footage against the timecards: one crew member clocking another in at 5:20 AM
who arrived at 5:39; a person clocked in 5:17 AM–7:15 PM and 6:11 AM–1:22 PM
on days his car was never on the property; and the cameras had stopped
recording after 5 PM. "These are the issues I'm dealing with that with the
right technology can be fixed." The phone already records every shift (above);
this is the READING of that record against the clock, so the office finds
these on /timecards instead of on a camera.

**Reads (no switch needed, `lib/timecards.ts`, `timecard_gps_stats_v2`):**
- **Never on site** — ≥ 5 fixes, none inside the clocked site (replaces
  Mostly off-site). "Never on Maple Ridge: 200 phone fixes during the shift,
  none inside the site."
- **Shared phone** — the same device id (a random id the app keeps per
  phone, `lib/device-id.ts`, stored as `device_id` / `out_device_id`) on
  entries of two different people in the window. "Same phone as <teammate>"
  — names, never ids. The buddy-punch tell for "logged in as my buddy on my
  phone". A shared crew tablet trips it on purpose; the photo policy is the
  answer there.
- **Clocked in away / Clocked out away** — the tap's fix ≥ 400 m (¼ mi) from
  the site's edge and not inside a yard. "Clocked in 1.9 mi from Maple Ridge."
- **Arrived after clock-in** — the first fix INSIDE the site is ≥ 10 min after
  clock-in, the phone was somewhere else first (the first fix of the shift is
  ≥ 10 min before the first on-site one), the tap was > 100 m off the site,
  and not a yard start. "On site 19 min after clocking in."
- **Left before clock-out** — fixes CONTINUED off the site ≥ 10 min after the
  last on-site fix (a phone that went dark is a different story), the
  clock-out tap was > 100 m off the site, not a yard finish. "Left the site
  45 min before clocking out."
- **Phone never moved** — closed shift ≥ 2 h, ≥ 10 fixes, all within 50 m
  corner to corner (a phone left in a parked truck).
- **No GPS** now says the hours: "14.0 h clocked with no phone fixes at all."
- **No photo** — only when the company policy requires one.

Every read is a `finding` sentence on the entry; `review` marks the entry
for the **Needs a look** list at the top of /timecards (managers, worst
first per `INTEGRITY_FLAGS`, one row per entry, tap → the entry). The
sentences ride the CSV (`Findings` column) and the `time_cards` tool
(`findings` per entry, `needsALook` at the top). False positives were
designed out and are asserted: a yard start is not "away" or "late", a slow
first fix is not an arrival, a tap at the fence line is at the site, a phone
that went dark is not "left early".

**Policies (Settings → Time clock, `companies.clock_policy`, all OFF by
default, `lib/clock-policy.ts`):**
- **Photo at clock-in / clock-out** — the front camera opens on the Clock in
  tap (the button becomes the camera) / inside the daily log. Shrunk on the
  phone to 720 px JPEG (~100 KB, `lib/image-shrink.ts`), sent inside the
  action (clock-in: a data URL in the JSON; clock-out: a file in the
  FormData), checked (JPEG magic, ≤ 400 KB) and stored by the service role in
  the PRIVATE `clock-photos` bucket under `<company>/<user>/<uuid>.jpg` — a
  CHECK constraint refuses any other path on the row. /timecards mints 1-hour
  signed URLs for the rows the caller could read. Nobody recognises faces; a
  human looks. Required server-side too; an offline clock-out replay that
  lost its Files is waived (the card then reads "No clock-out photo").
- **Clock in only at the site** — refused unless the fix is inside the
  chosen zone or within the radius (default 500 ft / 150 m; 150 ft – 1 mi)
  of its edge, or inside any yard the company has drawn. "You're 980 ft from
  Maple Ridge — clock in when you get there, or from the yard." Enforced in
  `clockInAction` (`clockInPlaceCheck`), so a direct call and an offline
  replay (judged on the fix it was tapped with) obey it too. Shop / office
  clock-ins are not guarded.

The 104 column guard learned the new columns: a session may set the
clock-out device and photo only while closing its own open entry; the
clock-in pair never changes from a session. **Harness:
`node scripts/timecards-test.mjs` (85 assertions) — run it after ANY change
to `lib/timecards.ts` or `lib/clock-policy.ts`.**

**The reviewer pass on 120 (same day, migration 121):**
- **A session may only OPEN an entry** (121 `guard_time_entry_insert`): a
  member's own JWT could insert a row already closed, with a photo path that
  pointed at nothing, a break, an edit trail — and the photo policy read the
  fake path as "photo present". Clock-in fields only on INSERT; the server
  sets `in_photo_path` with the service role right after the insert; the
  close is still the guarded UPDATE.
- **Photos are stored only when the policy asks** (a photo in the payload of
  a company with the switch off is ignored), only after the row exists, and
  the shape (category, site UUID) is checked before anything is uploaded —
  the first cut uploaded first and could be made to fail the insert after.
- **Retention: 90 days.** The health cron removes clock photos older than 90
  days (the row keeps its path, so the finding stays honest and the
  thumbnail simply ends) and any object no row points at after a day.
- **A switch has a date.** Turning a photo switch ON stamps `photoInSince` /
  `photoOutSince`; a shift clocked in before the stamp is never accused of a
  missing photo (a switch flipped on Wednesday used to flag Monday).
- **An open shift gets an hour** before "Never on site" / "Mostly off-site"
  is said (five fixes exist 2½ min after clock-in; every crew driving in
  from the yard was on the list at 6:05), and an open yard start says nothing
  until it closes. **Phone never moved** is site shifts only (a mechanic's
  shop day stands still on purpose).
- **Above your role, hours only.** A person who outranks the viewer gets no
  GPS reads, no photos and no findings on that viewer's page/CSV/Ask AI
  (`viewerRank`); a Foreman does not audit the owner — and the owner's phone
  is hidden from lower ranks by 111, which used to read as "no phone fixes
  at all" on the Manager's list. The stats RPC runs under the service role
  for the entry ids the caller could read.
- **Ask AI:** a bare number never picks a machine ("what happened at 3" is
  not Truck 3); digits count only beside a word that matched the same name.
- Known and documented: the shared-phone read is a heuristic for a human —
  a device id is readable company-wide and a teammate could copy it into
  their own phone to make someone else wear the flag; the photo policy is
  the answer where that matters. Minutes ≥ 60 read as "2 h 30 min".

Next: a "needs a look" line in the Friday wrap-up, a push to the manager the
moment a shift closes with a red finding, and daily-OT states.
