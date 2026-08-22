import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual, createHash } from 'crypto'
import { lookupCompanyByKey } from '@/lib/ingest-auth'
import { MCP_TOOLS, runMcpTool } from '@/lib/mcp-tools'

export const dynamic = 'force-dynamic'

/**
 * HammerTrack Agent Interface — MCP over Streamable HTTP (POST-only,
 * stateless). A customer's own AI assistant (Claude, ChatGPT, anything
 * MCP-capable) points here with their company API key and can ask about
 * THEIR fleet: assets, zone costs, alerts, maintenance, tools.
 * docs/AGENT-INTERFACE.md is the customer-facing setup guide.
 *
 * Auth: `Authorization: Bearer <key>` or `x-api-key` = a per-company key
 * (companies.api_key — the Settings → Tracker API Key). The platform
 * INGEST_API_KEY is explicitly REJECTED here: it is a device credential
 * with no tenant, and this surface must always be scoped to one company.
 * Every tool call is bound to the authenticated company_id; other tenants'
 * existence is never revealed (unknown key → generic 401).
 *
 * Stateless per-request is valid for Streamable HTTP servers that only
 * answer POSTs with application/json — no session ids, no SSE stream.
 */

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const PROTOCOL_FALLBACK = '2025-03-26'
const KNOWN_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])
const SERVER_INFO = { name: 'hammertrack', version: '1.0.0' }

const DOCS_HINT = {
  error: 'This is an MCP (Model Context Protocol) endpoint — it only accepts JSON-RPC 2.0 over POST.',
  docs: 'https://github.com/briandillardre/hello-world/blob/master/docs/AGENT-INTERFACE.md',
  connect: 'claude mcp add --transport http hammertrack https://hammertrack.ai/api/mcp --header "Authorization: Bearer <your company API key>"',
}

// ── Per-key rate limit (in-memory sliding window) ────────────────────────────
// Serverless honesty: each warm instance keeps its own window, so the global
// ceiling is (60 × instances)/min — still plenty to stop a runaway agent loop,
// which is what this guards against.
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
// Second gate keyed by client IP: a flood that rotates garbage keys gets a
// fresh key-bucket every time, but not a fresh address (sec-check P2-1).
const IP_RATE_LIMIT = 300
const rateBuckets = new Map<string, number[]>()

/** Debit `cost` hits (batch = one per element, sec-check P1-1). */
function rateLimited(key: string, cost = 1, limit = RATE_LIMIT): boolean {
  // Bucket by a hash so raw keys never sit in process memory longer than the request.
  const id = createHash('sha256').update(key).digest('base64').slice(0, 16)
  const now = Date.now()
  const hits = (rateBuckets.get(id) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length + cost > limit) {
    rateBuckets.set(id, hits)
    return true
  }
  for (let i = 0; i < cost; i++) hits.push(now)
  rateBuckets.set(id, hits)
  // Bound the map under key-rotating traffic WITHOUT resetting legitimate
  // windows: evict oldest entries instead of clearing everyone.
  if (rateBuckets.size > 5000) {
    const keys = Array.from(rateBuckets.keys())
    for (const k of keys) {
      rateBuckets.delete(k)
      if (rateBuckets.size <= 4000) break
    }
  }
  return false
}

// ── JSON-RPC helpers ─────────────────────────────────────────────────────────

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } as const

// ── Auth ─────────────────────────────────────────────────────────────────────

function extractKey(request: NextRequest): string | null {
  const authz = request.headers.get('authorization')
  if (authz) {
    const m = /^Bearer\s+(.+)$/i.exec(authz.trim())
    if (m) return m[1].trim()
  }
  const xkey = request.headers.get('x-api-key')
  return xkey ? xkey.trim() : null
}

/** Timing-safe equality via HMAC-then-compare (same trick as ingest auth). */
function safeEqual(a: string, b: string): boolean {
  try {
    const secret = 'hammertrack-mcp-key-comparison'
    const ha = createHmac('sha256', secret).update(a).digest()
    const hb = createHmac('sha256', secret).update(b).digest()
    return timingSafeEqual(ha, hb)
  } catch {
    return false
  }
}

/** Resolve the caller's company id, or null (→ 401). Company keys ONLY. */
async function authenticate(request: NextRequest): Promise<string | null> {
  const key = extractKey(request)
  if (!key) return null
  // The platform ingest key is never a valid identity here — it has no
  // company, and accepting it would make one leaked device credential an
  // every-tenant read key.
  const platform = process.env.INGEST_API_KEY
  if (platform && safeEqual(key, platform)) return null
  if (isMock) {
    // Demo deployment (no database): any key tours the mock fleet.
    const { MOCK_COMPANY } = await import('@/lib/mock-data')
    return MOCK_COMPANY.id
  }
  return lookupCompanyByKey(key)
}

// ── Method dispatch ──────────────────────────────────────────────────────────

async function handleRpc(msg: JsonRpcRequest, companyId: string): Promise<Record<string, unknown> | null> {
  const id = msg.id ?? null
  const method = typeof msg.method === 'string' ? msg.method : ''

  // Notifications (no id) get no response body at all.
  const isNotification = msg.id === undefined || msg.id === null

  if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null

  if (!method || (msg.params !== undefined && typeof msg.params !== 'object')) {
    return isNotification ? null : rpcError(id, -32600, 'Invalid request')
  }

  switch (method) {
    case 'initialize': {
      const requested = String((msg.params as Record<string, unknown> | undefined)?.protocolVersion ?? '')
      return rpcResult(id, {
        protocolVersion: KNOWN_PROTOCOLS.has(requested) ? requested : PROTOCOL_FALLBACK,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: MCP_TOOLS })
    case 'tools/call': {
      const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown }
      const name = typeof params.name === 'string' ? params.name : ''
      if (!MCP_TOOLS.some((t) => t.name === name)) {
        return rpcError(id, -32602, `Unknown tool "${name}". Call tools/list for the registry.`)
      }
      const args = (params.arguments && typeof params.arguments === 'object')
        ? params.arguments as Record<string, unknown>
        : {}
      // Executor errors surface as { isError: true } tool results, never a 500.
      const result = await runMcpTool(name, args, companyId)
      return rpcResult(id, result)
    }
    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`)
  }
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Rate limit first (keyed by the presented credential) so brute-forcing
  // keys hammers this in-memory gate, not the database.
  const key = extractKey(request)
  const ip = (request.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
  if (rateLimited(`ip:${ip}`, 1, IP_RATE_LIMIT) || (key && rateLimited(key))) {
    return NextResponse.json(
      rpcError(null, -32000, `Rate limit exceeded — max ${RATE_LIMIT} calls per minute per key.`),
      { status: 429, headers: JSON_HEADERS }
    )
  }

  const companyId = await authenticate(request)
  if (!companyId) {
    return NextResponse.json(
      rpcError(null, -32001, 'Unauthorized: send your company API key as "Authorization: Bearer <key>" (Settings → Tracker API Key).'),
      { status: 401, headers: JSON_HEADERS }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error: body must be JSON-RPC 2.0'), {
      status: 400, headers: JSON_HEADERS,
    })
  }

  try {
    // Batches were valid through protocol 2025-03-26 — answer them too.
    if (Array.isArray(body)) {
      if (body.length === 0) {
        return NextResponse.json(rpcError(null, -32600, 'Invalid request: empty batch'), {
          status: 400, headers: JSON_HEADERS,
        })
      }
      // One POST must not multiply past the per-key limit (sec-check P1-1):
      // cap the batch and debit the bucket one hit per element.
      if (body.length > 20) {
        return NextResponse.json(rpcError(null, -32600, 'Batch too large (max 20).'), {
          status: 400, headers: JSON_HEADERS,
        })
      }
      if (key && body.length > 1 && rateLimited(key, body.length - 1)) {
        return NextResponse.json(
          rpcError(null, -32000, `Rate limit exceeded — max ${RATE_LIMIT} calls per minute per key.`),
          { status: 429, headers: JSON_HEADERS }
        )
      }
      const responses = (
        await Promise.all(body.map((m) => handleRpc((m ?? {}) as JsonRpcRequest, companyId)))
      ).filter((r): r is Record<string, unknown> => r !== null)
      if (responses.length === 0) return new NextResponse(null, { status: 202 })
      return NextResponse.json(responses, { headers: JSON_HEADERS })
    }

    const response = await handleRpc((body ?? {}) as JsonRpcRequest, companyId)
    // Notification (e.g. notifications/initialized): acknowledge, no body.
    if (response === null) return new NextResponse(null, { status: 202 })
    return NextResponse.json(response, { headers: JSON_HEADERS })
  } catch {
    return NextResponse.json(rpcError(null, -32603, 'Internal error'), {
      status: 500, headers: JSON_HEADERS,
    })
  }
}

export async function GET() {
  // Streamable HTTP allows a GET-opened SSE stream, but this server is
  // POST-only/stateless — tell humans and misconfigured clients where to look.
  return NextResponse.json(DOCS_HINT, { status: 405, headers: { ...JSON_HEADERS, Allow: 'POST' } })
}

export async function DELETE() {
  // No sessions to terminate on a stateless server.
  return NextResponse.json(DOCS_HINT, { status: 405, headers: { ...JSON_HEADERS, Allow: 'POST' } })
}
