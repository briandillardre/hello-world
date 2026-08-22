# HammerTrack Agent Interface (MCP)

Connect YOUR AI assistant — Claude, ChatGPT, or anything that speaks MCP
(Model Context Protocol) — directly to your fleet. Ask it "where's the
excavator?" and it answers from your live HammerTrack data.

*Why this exists: docs/AI-RESILIENCE.md — be the tool AI calls, not the tool
AI replaces.*

## Endpoint

```
https://hammertrack.ai/api/mcp
```

- Transport: **Streamable HTTP** (JSON-RPC 2.0 over POST, stateless, plain
  JSON responses — no SSE, no session management).
- Auth: your **company API key**, found in **Settings → Tracker API Key**
  (admins only). Send it either way:
  - `Authorization: Bearer <key>` (preferred)
  - `x-api-key: <key>`

## Connect from Claude Code

```bash
claude mcp add --transport http hammertrack https://hammertrack.ai/api/mcp \
  --header "Authorization: Bearer YOUR_COMPANY_API_KEY"
```

Then just ask: "where's my excavator?" — Claude discovers and calls the tools
itself.

## Connect from claude.ai (web / desktop / mobile)

Settings → Connectors → **Add custom connector** → URL
`https://hammertrack.ai/api/mcp`. When prompted for authentication, choose
API key / bearer token and paste your company key. (Custom connectors
require a paid claude.ai plan.)

## Connect from ChatGPT and other MCP clients

Any client that supports **remote MCP servers over Streamable HTTP with a
bearer token** works the same way: server URL `https://hammertrack.ai/api/mcp`,
header `Authorization: Bearer YOUR_COMPANY_API_KEY`. In ChatGPT this lives
under Settings → Connectors (developer mode); other agents (Cursor, LibreChat,
custom agents on the OpenAI/Anthropic SDKs) take the same URL + header pair.

## What your assistant can ask (v1 — read-only)

| Tool | Answers questions like |
|---|---|
| `list_assets` | "Where's the excavator?" · "What's moving right now?" · "Is anything at the Riverside site?" |
| `get_zone_costs` | "What did Riverside cost this week?" · "How are we tracking against the budget?" (args: `zone` optional, `days` 1–90, default 7) |
| `list_alerts` | "Any theft alerts this week?" · "Did anything move after hours?" (args: `days` 1–30, `limit` up to 200) |
| `maintenance_status` | "Anything overdue for service?" · "What work orders are open?" |
| `find_tool` | "Where's the demo saw?" — which truck it last rode with, when, and its recent carrier history (arg: `name`) |

All numbers come from the same math the HammerTrack screens use — the
exact-hours usage ledger for costs, the live telemetry stream for positions —
so the assistant never disagrees with the app.

**One brain, three doors:** this registry is also what the in-app Ask
assistant serves (plus its deeper per-asset tools — stops, telemetry, visit
logs). Asking in the app, asking your own AI over MCP, and future doors all
hit the same executors and the same house math. The one difference: the
in-app door knows WHO is asking, so cost tools are hidden from crew roles
without the cost permission — a company API key is always admin-grade.

## Security notes — read before you paste the key anywhere

- **The company API key is admin-grade.** Anything holding it can read your
  entire fleet **including dollar figures** (zone costs, budgets). Treat it
  like a password: give it only to AI tools YOUR company runs, never paste it
  into a shared or public assistant configuration.
- **Rotate it in Settings** if it ever leaks — the same Tracker API Key card
  that shows it. Rotation instantly cuts off every agent (and tracker
  integration) using the old key.
- **Read-only in v1.** No tool can move, edit, or delete anything. Action
  tools (create punch items, assign work orders, clock events) are planned
  for v2 behind the same key.
- **Tenant-scoped, always.** The key authenticates ONE company; every query
  is bound to it server-side. The platform ingest key is rejected here.
- **Rate limited** to ~60 calls/minute per key; heavy queries have a 10-second
  budget and row caps, so a runaway agent loop can't run up your bill or ours.

## For debugging (curl)

```bash
curl -s https://hammertrack.ai/api/mcp \
  -H "Authorization: Bearer YOUR_COMPANY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s https://hammertrack.ai/api/mcp \
  -H "Authorization: Bearer YOUR_COMPANY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_assets","arguments":{}}}'
```

A `GET` to the endpoint returns 405 with these instructions; a missing or
unknown key returns a generic 401 (keys are never confirmed or denied
specifically).

## Implementation map (internal)

- `app/api/mcp/route.ts` — transport: JSON-RPC envelope, auth, rate limit.
- `lib/mcp-tools.ts` — tool registry + executors (service client, explicit
  `company_id` scoping on every table; shared math from `lib/costs.ts`,
  `lib/db/maintenance.ts`, `lib/alerts-engine.ts`).
- `lib/ingest-auth.ts` — `lookupCompanyByKey` (shared with device ingest).
