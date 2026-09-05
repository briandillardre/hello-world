# Trackers — the drawer, swaps, and the 30-day safety net

Migration **092** (Sep 4 2026). Brian, after a real two-way swap: the OBD unit
came out of the 2003 Silverado 2500HD (dead OBD port) and went into the F750,
and a TAT141 went into the Silverado. *"We need an 'unassigned trackers'
bucket … think thru all potential switches and use cases … hold data for a
certain period of time for fall back protection of mistakes."*

## Model

| Thing | Where it lives | Notes |
|---|---|---|
| Which box is in which machine | `assets.tracker_id` | **The** source of truth. Unchanged. One ACTIVE owner per IMEI platform-wide (084). |
| Trackers the company owns | `device_onboarding` (083) | The registry. `unassigned_since` stamps when a box went into the drawer. |
| **The drawer** | derived | Registry rows whose IMEI no active, non-deleted asset wears. Never stored, so it cannot drift. Beacons (`EYE_BEACON`) excluded — tags live on /tags. |
| Pings nobody is wearing | `unassigned_locations` | Ingest buffers fixes for a **registered** IMEI with no active asset. Assigning the tracker pulls rows ≥ the chosen moment onto the asset (marked `raw._buffered=1` so undo can push them back). Unregistered IMEIs are still dropped — no company to file under. |
| Every change | `tracker_moves` | kind · tracker · from/to asset · `swap_at` (the history cut) · counts · `undone_at`. A swap is two rows sharing a `group:` note; undo reverses both. |
| Deleted machines | `assets.deleted_at` + `active=false` | Soft delete. Live readers already filter `active=true`; `getAssets` filters `deleted_at IS NULL`. Its tracker goes to the drawer. |
| The 30 days | `purge_retention(30)` | Called daily from `/api/cron/health` (11 UTC). Deletes assets past `deleted_at+30d` (FK cascade takes history), buffered pings older than 30 d, and moves older than 90 d (kept 3× as a plain audit trail). |

## The five cases (asset page → **Tracker** button, `components/assets/TrackerSheet.tsx`)

All go through `changeTracker()` in `lib/db/trackers.ts`, which composes two
primitives — `takeOff` and `putOn` — and records a move for each.

| Case | When | What happens |
|---|---|---|
| **Put a tracker on** | machine has none | From the drawer (buffered pings ≥ since land here), off another machine (a *take*: that machine's pings ≥ since move here), or a typed IMEI. |
| **Swap** | a different box went in as this one came out | Old tracker → drawer **or** another machine (pings ≥ since go with it); new tracker on. One group, one undo. |
| **Take it out** | pulled, going in the truck box | Tracker → drawer, `unassigned_since` = since. The machine keeps its history (there is no one else to give post-since pings to; a later attach from inside that window takes them). |
| **Move** | no replacement | = take off → other machine. Old flow's "moved OFF this vehicle". |
| **Renamed onto a new machine** | a record was reused for a different truck | Tracker stays; pings **<** since split to the old machine's record. Old flow's "kept the tracker". |

Every case: the swap moment is required and cut-precise; the sheet writes
a plain-language "This will:" before the button; a bad IMEI (Luhn) or an IMEI
owned by another account fails **before** anything is written.

## Undo rules (`undoMove`)

* 30 days from `created_at`, not already undone.
* Only the **latest** change to a given tracker can be undone (undo newer first).
* If the previous machine now wears a *different* tracker, undo refuses and says so.
* Buffered pings that landed on an asset go back to the buffer; moved pings go back by the same cut.

## Retention / restore

* Delete = 30-day soft delete (`softDeleteAssetAction`). Confirm text says what leaves, where the tracker goes, and that Trackers → Recently deleted brings it back.
* Restore: if its tracker was put on another machine meanwhile, the asset comes back **without** it and the toast says so.

## Known gaps (tracked)

* Moving pings between assets does not rebuild `trail_daily` / the zone-usage ledger for the affected days — those rollups key on row arrival time. Pre-existing from the old reassign; the hourly cron heals new days only. Task: re-bank affected asset-days after a move.
* `unassigned_locations` keeps 30 days; a tracker sitting installed-but-unassigned longer than that loses the older pings. Assign it.
