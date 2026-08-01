import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/**
 * Receipt photo drop for the magic capture link. The token authorizes exactly
 * one open charge; a successful capture closes it, so the link self-expires.
 * The receipt lands in the normal inbox as `pending` — AI extraction and the
 * human approve-to-QBO gate are unchanged.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (isMock) return NextResponse.json({ ok: false, error: 'Demo mode' }, { status: 400 })
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(params.token)) {
    return NextResponse.json({ ok: false, error: 'Bad link' }, { status: 404 })
  }

  const { createServiceClient } = await import('@/lib/supabase-server')
  const db = createServiceClient()

  const { data: exp } = await db.from('expenses')
    .select('id, company_id, merchant, amount, txn_date, status')
    .eq('capture_token', params.token).maybeSingle()
  if (!exp) return NextResponse.json({ ok: false, error: 'Link not found' }, { status: 404 })
  if (exp.status !== 'needs_receipt') return NextResponse.json({ ok: true, already: true })

  const form = await req.formData().catch(() => null)
  const photo = form?.get('photo')
  if (!(photo instanceof File) || !photo.size || !photo.type.startsWith('image/')) {
    return NextResponse.json({ ok: false, error: 'No photo attached' }, { status: 400 })
  }
  if (photo.size > 8 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: 'Photo too large (8 MB max)' }, { status: 400 })
  }
  const zoneRaw = String(form?.get('zone') ?? '')
  const zoneId = /^[0-9a-f-]{36}$/i.test(zoneRaw) ? zoneRaw : null
  // Never trust a zone id from an unauthenticated form — it must be this company's.
  let projectZone: string | null = null
  if (zoneId) {
    const { data: z } = await db.from('geofences').select('id').eq('id', zoneId).eq('company_id', exp.company_id).maybeSingle()
    projectZone = z?.id ?? null
  }

  // Same public bucket the field daily-log receipts use.
  const ext = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${exp.company_id}/${crypto.randomUUID()}.${ext}`
  const { error: upErr } = await db.storage.from('field-photos')
    .upload(path, photo, { contentType: photo.type, upsert: false })
  if (upErr) {
    console.error('capture upload failed', upErr)
    return NextResponse.json({ ok: false, error: 'Upload failed — try again' }, { status: 500 })
  }
  const url = db.storage.from('field-photos').getPublicUrl(path).data.publicUrl

  const { data: receipt, error: rErr } = await db.from('receipts').insert({
    company_id: exp.company_id,
    project_geofence_id: projectZone,
    url,
    status: 'pending',
    vendor: exp.merchant,
    amount: exp.amount,
    txn_date: exp.txn_date,
    note: 'Captured via receipt-chase link',
  }).select('id').single()
  if (rErr || !receipt) {
    console.error('capture receipt insert failed', rErr)
    return NextResponse.json({ ok: false, error: 'Save failed — try again' }, { status: 500 })
  }

  await db.from('expenses')
    .update({ receipt_id: receipt.id, status: 'matched' })
    .eq('id', exp.id)

  return NextResponse.json({ ok: true })
}
