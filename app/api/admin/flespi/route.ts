import { NextResponse } from 'next/server'
import { isPlatformOwner } from '@/lib/platform-owner'

/**
 * Founder-only door to flespi device commands (board #199).
 * GET  → is FLESPI_COMMAND_TOKEN working? (device count, idents' last 5 digits only)
 * POST { imei, text } → queue one Teltonika SMS/GPRS command (e.g. a setparam) for that unit;
 *      flespi holds it until the unit's next connection (24 h).
 */
const API = 'https://flespi.io/gw/devices'

function token() { return process.env.FLESPI_COMMAND_TOKEN || '' }

export async function GET() {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!token()) return NextResponse.json({ ok: false, error: 'FLESPI_COMMAND_TOKEN not set' })
  const r = await fetch(`${API}/all?fields=id,configuration`, { headers: { Authorization: `FlespiToken ${token()}` }, cache: 'no-store' })
  const j = await r.json().catch(() => null) as { result?: { id: number; configuration?: { ident?: string } }[]; errors?: unknown } | null
  if (!r.ok) return NextResponse.json({ ok: false, status: r.status, errors: j?.errors ?? null })
  const devs = j?.result ?? []
  return NextResponse.json({ ok: true, devices: devs.length, idents: devs.map((d) => '…' + String(d.configuration?.ident ?? '').slice(-5)) })
}

export async function POST(req: Request) {
  if (!(await isPlatformOwner())) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!token()) return NextResponse.json({ ok: false, error: 'FLESPI_COMMAND_TOKEN not set' }, { status: 503 })
  const body = await req.json().catch(() => null) as { imei?: unknown; text?: unknown } | null
  const imei = typeof body?.imei === 'string' ? body.imei.trim() : ''
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!/^\d{15}$/.test(imei)) return NextResponse.json({ ok: false, error: 'imei must be 15 digits' }, { status: 400 })
  if (!/^(setparam|getparam|getver|getinfo|getstatus) [\x20-\x7e]{0,400}$|^(getver|getinfo|getstatus)$/.test(text)) {
    return NextResponse.json({ ok: false, error: 'only setparam/getparam/getver/getinfo/getstatus' }, { status: 400 })
  }
  const sel = encodeURIComponent(`configuration.ident=${imei}`)
  const r = await fetch(`${API}/${sel}/commands-queue`, {
    method: 'POST',
    headers: { Authorization: `FlespiToken ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'custom', properties: { text }, ttl: 86_400 }]),
  })
  const j = await r.json().catch(() => null) as { result?: unknown[]; errors?: unknown } | null
  return NextResponse.json({ ok: r.ok && (j?.result?.length ?? 0) > 0, status: r.status, queued: j?.result?.length ?? 0, errors: j?.errors ?? null })
}
