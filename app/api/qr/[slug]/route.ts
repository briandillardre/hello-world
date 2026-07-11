import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

/**
 * QR sticker image for an asset's tap-to-log page (/t/{slug}).
 * SVG so it prints razor-sharp at any sticker size.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = params.slug.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
  if (!slug) return NextResponse.json({ error: 'bad slug' }, { status: 400 })

  const origin = req.nextUrl.origin
  const url = `${origin}/t/${slug}`
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H', // survives mud, scratches, and thumbs
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  })
  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'public, max-age=86400',
    },
  })
}
