import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { getPack } from '@/data/registry'
import { computeReceipt } from '@/lib/receipt'
import { moneyFull } from '@/lib/format'
import { CATEGORICAL } from '@/lib/palette'

export const runtime = 'edge'

export function GET(request: NextRequest, { params }: { params: { entity: string } }) {
  const pack = getPack(params.entity)
  if (!pack) return new Response('Not found', { status: 404 })

  const homeValue = Number(request.nextUrl.searchParams.get('home')) || pack.entity.medianHomeValue
  const ownerOccupied = request.nextUrl.searchParams.get('occ') !== '0'
  const receipt = computeReceipt(pack, { homeValue, ownerOccupied })
  const top = receipt.items.filter((i) => i.amount > 0).slice(0, 6)
  const maxAmount = Math.max(...top.map((i) => i.amount), 1)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#fcfcfb',
          padding: 56,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 26, color: '#52514e' }}>
              {`A ${moneyFull(homeValue)} home in ${pack.entity.shortName} pays`}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <div style={{ fontSize: 76, fontWeight: 700, color: '#0b0b0b' }}>
                {moneyFull(Math.round(receipt.primaryEntityTax))}
              </div>
              <div style={{ fontSize: 30, color: '#898781', marginLeft: 12 }}>/ year</div>
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#2a78d6' }}>DollarView</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 36, gap: 16 }}>
          {top.map((item) => (
            <div key={item.departmentId} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 260, fontSize: 26, color: '#0b0b0b' }}>{item.label}</div>
              <div
                style={{
                  height: 26,
                  width: Math.max(8, (item.amount / maxAmount) * 560),
                  backgroundColor: CATEGORICAL[item.colorSlot - 1],
                  borderRadius: 6,
                }}
              />
              <div style={{ fontSize: 26, fontWeight: 700, color: '#0b0b0b' }}>{moneyFull(item.amount)}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 'auto', fontSize: 20, color: '#898781' }}>
          {`${pack.entity.name} · ${pack.entity.fiscalYearLabel}${pack.entity.isDemo ? ' · fictional demo data' : ''} · see yours at DollarView`}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
