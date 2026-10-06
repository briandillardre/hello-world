# Location privacy by place and shift

Migration 132 · Oct 2026 · from the market brief Brian forwarded: Motive now
uses geofences to decide what its devices may **collect**, not just to fire
entry alerts, the rules run on the device, and the driver can see that
recording stopped. HammerTrack applies the same principle to the people side
of the fleet:

- **Outside an active shift:** no worker-location collection.
- **At privacy-sensitive places:** suppress the coordinates entirely.
- **Theft recovery:** explicitly authorized, audited, time-boxed tracking.
- **At the assigned project / during an equipment transfer:** lower or higher
  frequency — designed below, not built yet (see *Deferred*).

The aims are less battery, less privacy exposure, and tracking an employee
can read in one card and believe.

**The rule lives in one pure file:** `lib/location-policy.ts`
(harness `node scripts/location-policy-test.mjs`, 166 assertions). Its
database half is `lib/location-privacy.ts`. The SQL is
`supabase/migrations/132_location_privacy.sql` (harness
`scripts/privacy-sql-test/run.sh`, local PostgreSQL 16, 32 checks + the
view-append check).

## What a phone may leave behind

"Kept" = written to the database. Company trucks and machines (their own
OBD / GPS / battery trackers) are company property and are **never** run
through this table — they report all the time, after hours and inside
privacy zones too.

| Phone source | Shift | Place | Person's point kept? | Tags the phone hears |
|---|---|---|---|---|
| Shift recorder (`/api/clock/fix`) | on the clock | outside privacy zones | **yes** — up to every 30 s, sooner after a 40 m move | — |
| Shift recorder | on the clock | inside a privacy zone | **no** (the clock card says "Paused — you're in a privacy zone") | — |
| Driver safety score (`/api/cron/driving`, migration 129) reading the shift recorder's points | on the clock | riding in a company road vehicle as the **only** phone aboard (≤ 150 m of the moving truck for 5+ min) | **no new point** — the kept shift points are matched to the truck, and its speeding, hard stops and late-night miles count toward that person's driver safety score, seen by them and anyone who outranks them (the company-key MCP door is admin-grade and sees every driver); never in the insurer report. With other phones aboard, only "rode along" miles are noted | — |
| Tag listener (`/api/ingest/ble-phone`) | on the clock | outside privacy zones | **yes** — on the person's `phone-<uid>` asset | **custody**: they ride WITH the phone (tool_associations + pairing_log name it), exact |
| Tag listener | on the clock | inside a privacy zone | **no** | **anonymous**, at the zone's centre |
| Tag listener | off the clock | anywhere outside zones | **no** — the phone asset is not touched, not even created | **anonymous**, on a ~250 m grid cell |
| Tag listener | off the clock | inside a privacy zone | **no** | **anonymous**, at the zone's centre |
| Tag listener, tag's asset **in recovery** | off the clock | outside privacy zones | **no** | **anonymous**, at the **exact** spot |
| Tag listener, tag's asset in recovery | any | inside a privacy zone | **no** | anonymous, at the zone's centre (the zone wins) |
| Go Live (`/track`, Share location) | either | outside privacy zones | **yes** (the person turned it on) | — |
| Go Live | either | inside a privacy zone | **no** (the row reads "Paused — you're in a privacy zone") | — |
| Clock-in / clock-out tap | — | anywhere | **yes, exact**, on the time entry (see below) | — |
| Photos, receipts, daily logs | — | anywhere | yes, where taken/sent (unchanged) | — |

"Anonymous" = a row in `tool_sightings`: the tool, the place, how rough the
place is on purpose (`precision_m`: 250, a zone's radius, or NULL = exact,
which only a recovery may carry — a CHECK enforces it), first/last heard and
a count. **No phone, no person, no user id.** Repeat sightings of one tool at
one place fold into one row (`anonFold`). Kept 30 days (trimmed whenever a
company adds a row).

"On the clock" = an open `time_entries` row (no `clock_out_at`) — the same
test the shift recorder's route uses. A failed read counts as OFF the clock
(nothing of the person is kept). A forgotten clock-out keeps the person on
the clock, exactly as the shift recorder already did (its notification stays
up the whole time).

**"Stop sharing" still means it.** A person whose Go Live share was stopped
(their phone asset is inactive) gets a 409 from the tag listener on or off
the clock — it reports nothing until the shift recorder revives the asset at
their next clock-in. Unchanged from Sep 12; now said on the card.

**Fail closed for passive collection.** If the privacy-zone read fails, the
tag listener and the shift recorder answer 503 and keep nothing (the phone
holds its batch and resends), and Go Live returns `privacy_check`; nothing is
ever kept "because the check was down".

## Tool positions now (and the tradeoff)

Before: an off-the-clock tag sighting moved the tool's **custody** to the
person's phone, so the map drew the tool riding with the person and the
person's own dot (and trail) kept moving all evening. On Oct 6 a 14-day read
found **294 phone gateway fixes, every one off the clock — 293 from the
owner's own phone**, which has been owner-only since Sep 18.

After:

- **Map** (`/api/map-data` → `resolveToolLocations(…, anon)`): a tool shows
  at its newest anonymous sighting when that is newer than its custody
  sighting — unless a truck (or on-the-clock phone) heard it near there in
  the 25 min before (`anonymousWins`: a parked truck re-hearing the tag every
  minute keeps its exact spot instead of flickering to a cell centre). The
  location is marked `raw.anonymous` with `accuracy` = the deliberate
  roughness, and the tool sheet says "Rough area · ~250 m · heard 2 h ago"
  (or "In a privacy zone", "Recovery · exact spot") instead of "Left here ·
  last with <truck>". No point-of-interest name is looked up for a cell
  centre.
- **Custody card** (`/api/tool-custody` → "Rides & sightings"): anonymous
  rows interleave with rides — "Heard off the clock · ~250 m ×3 · Oct 5".
- **Ask AI / MCP `find_tool`**: `heardOffTheClock[]` (place, roughness, why,
  from/to, times heard) and `bestPosition` (the same pick as the map); the
  tool description tells the model these never say whose phone — never guess.
- **Custody itself** (`tool_associations`, `pairing_log`, the hauling badge,
  rode-with/seen-by, replay trails, the hours ledger's tool presence) is
  untouched by anonymous sightings, so the invoice-grade ledger (057/090)
  does not move.
- **Visibility (111) holds on both ends.** RLS hides a sighting of a hidden
  tool, and every row carries `visible_rank` = the reporting phone's own
  level (`reporterRank`: the owner's phone is owner-only, an Admin's is
  Admins, a phone not yet on record gets the level it would be created with),
  raised to the tag's custody holder's level while that holder still keeps
  it (`anonRank`, the 3 h arbitration window) — so neither the owner's
  hidden phone nor a hidden truck resurfaces as a company tool at a rough
  place near them. A "view app as" preview reads at the previewed rank.
  Honest limit: a row stored at the owner's or Admins' level does say "a
  phone at that level heard it" to the few who may read it — never which
  phone, and crew rows (level 0) say nothing at all.

**UX tradeoff:** off the clock you learn **where** a tool is (roughly), not
**who** has it. The custody history still shows the last on-the-clock
carrier ("rode with Truck 3 until 5:02 PM"), so "it went home with the 5 PM
crew" is still answerable from work-time data. For a tool that really is
missing, recovery gives the exact spot — still without a name.

The assets list, the Command Center, the zones page and `/api/reverse-geocode`
still place tools from custody only (no anonymous placements yet — a cell
centre would need its own "rough area" wording there). Follow-up, below.

## Privacy zones

- **What:** `geofences.privacy_zone` (boolean, default false), appended to
  `geofences_json` (the 123 rule). A flag, not a new zone kind: every screen
  that switches on kind (map colours, the draw dialog, the ledger's site/yard
  loop, reports, the simulator) stays untouched.
- **Which zones:** only **Boundary** or **Vendor** zones. Sites and yards are
  where crews work — time cards check the phones there — so the action
  refuses them and the server ignores a flag left on a zone that was later
  turned into a site (`privacyZonesFromRows`).
- **Who:** Admins and the owner, on the zone page (`PrivacyZoneCard` →
  `setPrivacyZoneAction`, service role after the check). A trigger
  (`ht_guard_privacy_zone`) refuses the column to every session, so the
  company-wide zone policy cannot be used to flip it through the API.
- **A home or a clinic nobody else should see on the map:** draw it as a
  personal zone ("only me"). Only its maker sees the outline; the server
  still reads it and it still protects every phone.
- **Effect:** inside one, no shift-recorder point, no tag-listener fix and no
  Go Live point is kept; tags heard there are placed at the zone's centre
  (area-weighted, `ringCentre`), roughness = its farthest corner. The server
  caches a company's zones for 30 s per instance, so a newly marked zone
  takes effect within half a minute.
- **Crew see it:** a non-Admin sees a one-line "Privacy zone" note on the
  zone's page.

### Clock-in / clock-out inside a privacy zone: kept exact (decision)

The punch keeps its exact fix on the time entry. Why:

1. It is an **explicit act**, one point per tap, made where the person
   chooses to start or end paid time — not a trail.
2. It is **evidence the person may need**: the time card's integrity findings
   (clocked in away from the site, yard starts), the clock-in-at-site rule
   and the DOT short-haul record (150 air-miles from the first clock-in) all
   measure from it. Moving or dropping it would weaken the record that
   defends the person's own hours.
3. Privacy zones are never sites or yards, so a punch inside one is rare.

What the zone still changes: the time card (page, CSV, Ask AI) words such a
punch only as **"in a privacy zone"** — never the zone's name or a street
(`lib/db/timecards.ts`). The employee card says all of this.

## Recovery

- **Who/how:** an Admin or the owner, on the asset page (`RecoveryCard`), with
  a reason (3–300 chars). From `/alerts`, a theft or left-site card offers
  **Start recovery** (lands on the asset page with the form open and the
  alert id kept for the audit trail).
- **How long:** 7 days (`RECOVERY_DAYS`), then it ends on its own; **Extend**
  gives it 7 days from that moment; **Stop — it's found** ends it.
- **Audit:** `asset_recovery` — started_by/at, reason, expires_at,
  extended_by/at, ended_by/at, alert_event_id. One open row per asset
  (unique index). A row that ran out is closed lazily at its expiry with
  `ended_by` NULL. Members read (RLS: company + 111 + prospects none); only
  the server writes.
- **While it runs:** phones **off the clock** report that asset's tag at the
  exact spot (still anonymous); the asset page shows a red **In recovery**
  banner (who started it, when it ends, last heard, a map link; Admins see
  the reason and the buttons); the map's attention slot shows 🚨 and the
  asset wears the alert ring; the map sheet says "In recovery · until …".
- **Vehicles and machines** with their own trackers: recovery marks and
  audits them; their trackers report as they always do (faster reporting is
  the deferred next step below).

## What the employee reads

`components/settings/WhatWeRecord.tsx` — on **My phone** (`/settings/phone`,
the page every role can open) and inside the shift recorder's location
disclosure ("Exactly what HammerTrack records about you", opened in place).
Every line is what the code does; **change the code and the card in the same
commit.** The same facts, in fewer words: the shift recorder's disclosure
(`ShiftTracker` — Play's prominent disclosure; it names the driver safety
score), the one-time location primer (`LocationPrimer`), the tag-listener
switch card (`GatewayToggle`) and its first-run primer (`PhoneGateway`), the
zone page's `PrivacyZoneCard`, the asset page's `RecoveryCard`, the Tool tags
and Clock in help guides, and the public policy at `/privacy`. The tag
listener's status line says which way each report was filed ("off the clock
— tags' rough area (exact for an item in recovery), nothing that says it was
you").

Two facts every surface keeps straight:

- The phone sends its fix when it hears **any** tag — it cannot tell a
  company tag from a shop's beacon (`tagShaped` in `lib/ble.ts`) — and off
  the clock the server keeps nothing for a tag that is not a company tool.
- A clock-in or clock-out tap, a photo and a receipt keep their spot even
  inside a privacy zone, so no surface says "nothing is kept" without
  "automatic" (or "no shift points").

## Deferred, and why

### Low-frequency presence at the assigned site (NOT built — needs time-weighting first)

The time card's **GPS-verified %** is a COUNT ratio: `timecard_gps_stats_v2`
returns `fixes` and `on_site` (fixes inside the clocked site), and
`lib/timecards.ts` computes `onSitePct = on_site / fixes` (and `verifiedPct`
the same across a week). Recording less often inside the site would shrink
`on_site` against the off-site points and bias every crew's % downward — and
trip "Mostly off-site" (`OFF_SITE_BELOW_PCT`) on people who were on site.

The change required, in this order:

1. **Migration**: `timecard_gps_stats_v3` = v2 plus `tracked_s` and
   `on_site_s`, each fix weighted by the time to the next fix (the last one
   to the shift's end), capped at 10 minutes so a dead zone is not evidence
   either way:
   `LEAST(EXTRACT(EPOCH FROM COALESCE(LEAD(l.timestamp) OVER w, LEAST(te.clock_out_at, now())) - l.timestamp), 600)`
   summed overall and `FILTER (WHERE ST_Contains(g.geometry, l.geom))`.
2. **`lib/db/timecards.ts`**: call v3 first, fall back to v2.
3. **`lib/timecards.ts`**: `onSitePct = on_site_s / tracked_s` (count ratio
   only when the seconds are absent); `verifiedPct` = Σ on_site_s / Σ
   tracked_s; keep `NEVER_ON_SITE_FIXES` as a count (it asks "enough points to
   judge"), re-check `OFF_SITE_BELOW_PCT`.
4. **`scripts/timecards-test.mjs`**: a fixture with 5-minute points inside
   the site and 30-second points outside, half the shift each — the count
   ratio reads ~9 %, the time ratio must read ~50 %; every existing
   assertion still passes.
5. **Only then** the cadence: `/api/clock/state` returns the clocked site's
   ring; `ShiftTracker` uses `MIN_PUSH_MS` = 5 min while the last fix is
   inside it (the 40 m move trigger stays, so leaving is caught at once) and
   the tag listener eases to its idle window there.

### Higher-frequency reporting during recovery or an equipment transfer (NOT built)

Recovery today changes what PHONES keep. Making a vehicle's or machine's own
tracker report faster needs:

- flespi's device **commands queue** (commands wait for the unit's next
  connection) carrying a Teltonika `setparam` for the data-acquisition "min
  period" on move / on stop — look the parameter ids up per model and
  firmware in Teltonika's list; do not guess them (the beacon-record periods
  137/139 in docs/DEVICE-ONBOARDING.md are a different setting);
- a flespi token with device-command rights in Vercel (none today — the
  webhook token is ingest-only);
- a per-model profile (FMM00A on truck power can afford seconds; a TAT141 on
  its own cells cannot — say what it costs in battery days before sending);
- a restore step when recovery stops or runs out (the health cron already
  runs hourly — it would close expired recoveries and queue the restore),
  and the banner saying "reporting every 10 s since 9:14 PM";
- the same audited, time-boxed row for an **equipment transfer** (a
  `kind: 'transfer'` on `asset_recovery` or its own table) so a lowboy move
  gets a dense track without a standing high rate.

### Also left for later

- **On-device enforcement.** The phone still sends its exact fix with the
  tags so the server can check privacy zones, recovery and the shift; the
  server keeps none of it off the clock. Sending only a pre-snapped cell
  when the app knows the shift is closed and no recovery tag was heard would
  keep the fix from ever leaving the phone (the server's rule stays the
  authority).
- **Photos, receipts and daily logs inside a privacy zone** keep their spot
  (explicit acts, like punches). Snapping them to the zone is a small change
  in `lib/actions/photos.ts` / the receipt capture route if Brian wants it.
- **Anonymous placements in the assets list, Command Center and zones page**
  (they still show custody), with "rough area" wording instead of an address.
- **History already stored**: the off-the-clock gateway points written before
  132 (the 294 above) are still on those phone assets. No purge was run —
  that is Brian's call (they are mostly the owner's own phone).
- **Privacy zones on the map** are drawn like any zone to everyone who can
  see zones; use a personal zone for a place others should not see.

## Rules for future code

- Any new code that writes a **worker phone's** location must go through
  `pushPhoneLocation` (it checks privacy zones before it creates or revives
  the phone asset) or call `loadPrivacyZones` + `privacyZoneAt` itself, and
  decide on/off the clock with `phoneFixPolicy`.
- A phone may become a **custody gateway** (tool_associations / pairing_log)
  only when `phoneFixPolicy(...).custody` is true.
- Any new `geofences` column must be appended to `geofences_json`, and any
  later rebuild of that view must keep `privacy_zone` (132 appends to
  whatever the view holds; a hard-coded list would drop it — 42P16).
- A new RLS table adds its `ht_prospect_lockdown` line (both new tables do).
