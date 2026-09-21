# Roles v2 — the ladder, the view-levels table, "View as", and the AI firewall

Migration **094** (Sep 4 2026). Brian's spec, verbatim in `lib/permissions.ts`.

## The ladder

| Rank | Role | How it is decided | Defaults |
|---|---|---|---|
| 4 | **Master Admin** | Not stored. The profile whose id **is** the company id — the account that created the company. One login by construction. Shows to everyone else as a plain **Admin**; only the Master sees the crown. | Everything, always. Sets the view-levels table for every role, Admin included. |
| 3 | Admin | `profiles.role = 'admin'` | Everything unless the Master says otherwise. Sets view levels for Manager / Foreman / Associate. |
| 2 | Manager | `'manager'` | Operations + **job costs and receipts**, not the books (no Accounting / Financials). |
| 1 | Foreman | `'foreman'` | Operations, **no dollar figures**. |
| 0 | Associate | `'associate'` (was Viewer) | Map, alerts, clock, daily logs, assets, zones, tags, maintenance, share location, receipts, Ask AI. |

Every rule is **strictly down the ladder**: you manage, preview, and read the AI chats of people below you; never equals, never above. The Master is above everyone.

## The two layers

1. **View levels** — `companies.role_policy` JSONB, a sparse `role → feature → on/off` override on `ROLE_FEATURE_DEFAULTS`. Edited on `/team` (the table at the bottom). Master edits every column; Admins edit the roles below them. A page outside your view levels is not greyed out — it is not in the nav and the route 404s (`requireFeature` at the top of every gated page + `featureForPath` in both navs).
2. **Per-person switches** — the three that already existed (`can_view_costs`, `can_manage_billing`, `can_manage_team`) for exceptions. Ignored for Admins.

`getMyPermissions()` in `lib/permissions-server.ts` is the ONE resolver; `getMyRole()` delegates to it. `Permissions.features` is the effective list; the four booleans are derived from it.

## "View app as"

Team → a member → **View app as …** (Master + Admins, only for people they outrank). Sets an httpOnly session cookie `ht_view_as`. `getMyPermissions()` then returns **that person's** permissions with every write ability off — a read-only preview, never a way to act as them. An amber banner with **Exit** sits above every page. Ask AI works in the preview but **does not persist** the conversation (the rows would be the admin's own).

**At the top of the app too (Sep 21 — Brian: "Add 'view as' somewhere at the top. Want to make sure what is visible and what is not for people").** `components/layout/ViewAsPicker.tsx` is one picker with three doors: **View as…** in the map's company/account menu, under the company name in the desktop sidebar (an eye button when collapsed), and a full-width button in the phone's More drawer. It lists the people the REAL caller may preview — `listViewAsTargetsAction()` reads the roster under the caller's own RLS and keeps only those they outrank (a Prospective Client only for the Master) — grouped by role, searchable past six, and a tap sets the same cookie and opens the map as that person. The doors are hidden while a preview is on; the amber bar owns that state.

## Prospective Client (migration 118)

Brian, Sep 21: "add an option for a team member to be a 'Prospective Client' — they can not see the other team members and are hidden to everyone on teams except me." A login that sees the **product** and never the **people**: the owner hands one to a prospect so they can look at a live account.

* **Role `prospect`**, label "Prospective Client", listed under Associate. Shares the Associate's rank for what it may SEE on the map (everyone-visible machines) but sits outside the ladder otherwise: `MASTER_ONLY_ROLES` — only the Master may invite one, see one, change one, or preview one (`outranks`, `canSeeMember`, `assignableRolesFor`, `rolesEditableBy`). An Admin's /team, invite picker, view-levels table and View-as list never mention the role.
* **Sees no teammates.** RLS on `profiles`: a prospect reads only their own row; a prospect's row is readable only by the Master and by themselves. Their pending invite is hidden the same way, and a prospect reads no invites at all. Crew phones are `personnel` assets, so a restrictive policy on `assets` hides the type from prospects and 111's "follows asset visibility" policies carry that to fixes, trails and alerts. The people-shaped tables (time entries, daily logs, expenses, receipts, device tokens, pairing log, field photos, invites) are unreadable for a prospect outright. `lib/permissions.ts` mirrors the asset rule (`canSeeAsset(p, meta, type)`) so a Master's view-as preview of a prospect is honest.
* **Changes nothing.** A restrictive read-only policy for the prospect role on every RLS-enabled public table (insert / update / delete), so a direct PostgREST call with their JWT cannot write either. Their view levels default to `map` · `assets` · `zones` — no clock or share-location (either would put THEIR phone on the map as a person), no Ask AI (reads company data, costs per call), no dollars; the Master widens per company in the view-levels table. Every push switch defaults off.
* **Proven locally** (PG 16, stub `auth.uid()`): prospect sees own profile only, the truck but not the phone (and the phone's fixes vanish with it), no time entries, no invites; insert/update/delete all refused; Admin and crew see three teammates and no prospect; the Master sees all four; the migration re-applies cleanly.

## The AI firewall

* **Build-time, not prompt-time.** `scripts/ai-firewall.mjs` runs before `next build` and fails the build if any file on the AI surface (`lib/ai-tools.ts`, `lib/mcp-tools.ts`, `lib/assistant.ts`, `lib/memo.ts`, `lib/insights.ts`, `lib/briefing.ts`, `app/api/assistant`, `app/api/mcp`, `app/api/memo`, `app/api/insights`) imports the board (`lib/board.ts`), `docs/`, `CLAUDE.md`, `marketing/`, the foreclosure tool, the founder gate, or performs any filesystem read. The to-do list, growth plan and business docs simply cannot enter the model's context.
* **Conversations go down the ladder only.** `ai_messages` RLS stays per-user. `lib/db/ai-convos.ts` reads with the service role and enforces rank: `/team/<id>/ai` shows a member's chats to anyone who outranks them; equals see nothing of each other; the Master sees everyone's.
* **Ask AI is a view level** (`ask_ai`): off for a role = launcher hidden and `/api/assistant` answers 403.

## Hardening from the review pass (migration 096)

* `invites` is **read-only for members** (it was `FOR ALL` with no `WITH CHECK` since 010 — any member could insert an admin invite and accept it). Every write path runs on the service role.
* `companies.role_policy` joined the 072 deny-list trigger: a client `PATCH` cannot rewrite the view-levels table; only the rank-checked team action can.
* **No laddering**: nobody can switch ON a view level or per-person switch they do not hold themselves (the Master holds everything).
* **View-as intersects with your real permissions**: an Admin the Master restricted cannot see more by previewing a Manager.
* `requireEditOrThrow()` sits at the top of every mutating server action for zones, assets, alerts rules, maintenance, work orders, imagery, projects, measurements, places, devices and tag pairing — the `edit` view level and the read-only preview are enforced at the action, not just hidden in the UI.
* `getMyPermissions` / `getRealPermissions` are `React.cache`d: one resolution per request however many pages and gates ask.

## Where the old "viewer" went

`normalizeRole()` maps a stored `'viewer'` to `associate`; 094 rewrites the rows and the CHECK constraints (profiles + invites). No code compares role strings for edit rights any more — `perms.canEdit` / `perms.features` do.

## Per-asset visibility (migration 111)

The view-levels table says which PAGES a role may open. This says who may see ONE asset — anywhere.

- `assets.metadata.visibility` is `managers`, `admins` or `master`; absent means everyone in the company. Ranks line up with the ladder: a viewer sees an asset when their rank ≥ the asset's (Master 4 · Admin 3 · Manager 2 · Foreman 1 · Associate 0).
- **Enforced in RLS.** A RESTRICTIVE policy on `assets` (`ht_visibility_rank(metadata) <= ht_viewer_rank()`), also as WITH CHECK, so nobody can write a level above their own rank. Every asset-keyed table carries a `follows asset visibility` policy that `EXISTS`-joins to `assets` under the caller's own RLS — pings, trails, alerts, site hours, service history, photos and tag pairings vanish with the machine. `tool_associations` checks both ends: a tag aboard a hidden truck is hidden with it.
- **Who bypasses it:** service-role paths — ingest, crons, the company-key MCP door. They see everything by design.
- **What RLS cannot see:** "View app as" (RLS sees the real uid). `canSeeAsset` / `visibleAssets` in `lib/permissions.ts` mirror the ladder and are applied to the effective permissions in `/api/map-data`, the assets list and the asset page (404).
- **UI:** the *Who can see this* card on the asset page (Admins and the owner; levels above your own rank are shown disabled), a 🔒 chip on list rows and the asset header. `setAssetVisibilityAction` is the only writer; the edit form carries the stored level across a save.
- **Defaults:** an owner's phone asset is created `master`, an Admin's `admins`. Crew phones stay visible — that is what clock-in tracking is for.

## The reviewer follow-up on 118 (migration 119, Sep 21)

The same-night sec-check and ship-check passes on the Prospective Client
found that the sandbox was enforced in RLS while three service-role doors
handed the same data straight to the sandboxed login. All fixed in 119 + the
matching code:

* **The company API key left the company row.** `companies.api_key` was
  readable by EVERY member's session through PostgREST (the public anon key
  plus their own JWT), and it is the only credential `/api/mcp` takes — so
  any login, prospect included, could read the key and then read the whole
  company (people, hours, dollars, owner-only machines) through the
  service-role tools behind it. Pre-existing for every sub-Master role; 118
  made it a three-request exploit by an outsider. The key now lives in
  `company_api_keys` — RLS on, no policies, no session grants (a JWT gets
  "permission denied", never an empty set to keep probing); the service role
  alone reads and writes it (`lookupCompanyByKey`, the rotate action, the
  Settings card for admins). `companies_seed_key` (AFTER INSERT) seeds a key
  for every new company whichever signup path made the row, and
  `companies_scrub_key` nulls the old column on every write so an older
  build can never put a plaintext key back where a session can see it.
* **Deny by default.** 118 listed eight people-shaped tables; everything
  else stayed readable company-wide — QuickBooks/OEM/Plaid credentials, the
  hours and dollars ledgers, the owner memos, the company row's phone, email
  and billing ids. A prospect now reads ONLY an allow-list: their own profile
  row, assets / locations / trails / photos / telemetry, tool pairings,
  maintenance / service / work orders, alerts, zones / imagery / places /
  divisions / measurements / site weather / geocode cache, the flight log.
  Not the company row (the app falls back to plain defaults without it).
* **One call per table.** `ht_prospect_lockdown(tbl, allow_read)` applies
  the whole lockdown — 118's read-only policies plus the SELECT deny unless
  allowed. 119 runs it over every RLS table; **a new table must call it in
  its own migration** (`SELECT ht_prospect_lockdown('my_table', false);`),
  because a policy set at migration time is a snapshot.
* **The service-role doors.** `listTeammatesAction` / `sendViewLinkAction`
  (the share-view roster) read profiles with the service role and gated on
  the `map` view level alone — a prospect got the whole roster and every
  teammate saw the prospect. Both now refuse prospects and filter with
  `canSeeMember`; minting an export link or a view link refuses prospects
  too. `acceptInviteAction` no longer lets an invite minted below the Master
  lift a prospect out of the sandbox. Pushes skip a prospect for every kind,
  and their own notification switches cannot be turned on.
* **The view-levels table cannot widen a prospect past the sandbox.**
  `PROSPECT_NEVER` (edit · $ figures · billing · manage team · Ask AI · team ·
  activity · Command Center · clock · logs · share location · tags ·
  receipts · accounting · finance · settings · trackers · hardware) is
  stripped LAST in `resolvePermissions`, like the master-only keys; the
  table shows those cells as "—". The Master may still show a prospect more
  of the product: reports, maintenance, alerts, the flight log.

