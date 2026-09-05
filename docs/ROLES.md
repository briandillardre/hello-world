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
