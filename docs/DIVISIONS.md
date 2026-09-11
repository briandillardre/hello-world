# Divisions — one company, several operating units

Shipped Sep 11 2026 (migration 106). Brian: *"need to add a section of
different divisions of a company — this applies to all assets, geofences, etc.
Need a way to filter and also keep track of DCG Coastal vs Upstate for
example."*

## What a division is

An operating unit **inside one company**: same login, same books, same
trackers, one label that says which half of the business a truck, a job site
or a saved place belongs to.

Deliberately **not** a second company — crews cross between divisions, the
fleet is shared, and a tracker that moves from Upstate to Coastal has to keep
its history. Deliberately **not** the free-text `category` on assets — that
groups machines by kind ("Dozers"), applies to nothing else, and can't be
renamed in one place.

`division_id` is **NULL by default**. A company that never creates a division
sees the app exactly as it was: no chips, no filters, no extra column.

## Where it shows up

| Surface | What you get |
|---|---|
| **Settings → Divisions** | Create, rename, recolour, archive. Each row shows how many assets and zones wear it. |
| **Asset page** | A Division card — pick one, it saves on change. |
| **Zone page** | The same card for a job site. |
| **Assets list** | Division filter beside the type pills, and a colour chip on every row. |
| **Zones list** | Same filter; the chip rides the zone name. A parent stays visible when it *or* a sub-zone is in the division. |
| **Map** | A filter pill under the top bar. It filters the dots, the zone rings and the place pins **together** — a half-filtered map would lie. Tools follow the gateway they're aboard rather than vanishing. |

The filter choice is remembered per device and per surface (`ht_div_map`,
`ht_div_assets`, `ht_div_zones`), so an Upstate foreman gets an Upstate map
every morning without re-picking. "Unassigned" is a real choice in the list —
it's how you find what still needs labelling.

## Rules

- **Archive, never delete.** The label stays readable on everything that ever
  wore it; Restore puts it back in the pickers. A deleted division would
  `SET NULL` every row it touched — losing which half of the business a year
  of history belonged to.
- **One live name per company.** `divisions_company_name_idx` is unique on
  `(company_id, lower(name))` where not archived, so "Coastal" can't exist
  twice; an archived one doesn't block the name.
- **Writes go through `requireEditOrThrow()`.** A read-only role — or an admin
  inside a view-as preview — cannot label or rename anything, including by
  calling the server action directly.
- **Cross-tenant guard.** `setRowDivisionAction` verifies the division belongs
  to the caller's company before writing it onto a row, so a hand-made call
  can't borrow another company's label.
- **Pre-106 databases degrade to nothing**, they don't crash: the reads return
  `[]` on a missing table, every picker and filter renders `null`, and the
  actions answer in plain words ("Divisions need one database update").

## Code

| File | What |
|---|---|
| `supabase/migrations/106_divisions.sql` | Table, RLS, `division_id` on assets / geofences / places, indexes |
| `lib/db/divisions.ts` | `getDivisions`, `getAllDivisions`, `getDivisionCounts`, and `inDivision()` — the ONE filter rule every surface shares |
| `lib/actions/divisions.ts` | create / update / archive / `setRowDivisionAction` / `bulkSetDivisionAction` |
| `components/divisions/DivisionsCard.tsx` | The Settings card |
| `components/divisions/DivisionBits.tsx` | `DivisionChip`, `DivisionFilter`, `DivisionPicker`, `useDivisionFilter` |

## Not yet (next passes)

- **Bulk labelling from the list** — `bulkSetDivisionAction` exists and is
  capped at 500 rows; the assets list needs the multi-select UI to call it.
- **Bulk add / CSV import**: a `Division` column that matches by name.
- **Money by division** — reports, /finance and the owner memo still read the
  whole company. The label is on the rows the ledger already joins, so this is
  a grouping change, not a schema one.
- **Per-person default division** so a Coastal foreman's map opens filtered
  without touching the pill.
- Alerts, receipts and time cards inherit their asset's or zone's division at
  read time rather than storing their own.
