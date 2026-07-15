'use client'

import { useEffect, useState } from 'react'
import { linkHorizontal } from 'd3-shape'
import type { ReceiptLineItem } from '@/lib/receipt'
import { moneyFull } from '@/lib/format'
import { slotColor } from '@/lib/palette'

const ROW_H = 42
const LEFT_X = 132
const RIGHT_X = 336
const WIDTH = 720

/**
 * "Follow your dollar" — a single-source fan-out from your tax bill to each
 * department, ribbon width proportional to the department's share.
 */
export function DollarFlow({ items, totalLabel }: { items: ReceiptLineItem[]; totalLabel: string }) {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const visible = items.filter((i) => i.amount > 0)
  const height = Math.max(visible.length * ROW_H + 24, 180)
  const sourceY = height / 2
  const total = visible.reduce((s, i) => s + i.amount, 0)
  const maxRibbon = 26

  const link = linkHorizontal<{ source: [number, number]; target: [number, number] }, [number, number]>()
    .source((d) => d.source)
    .target((d) => d.target)

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${height}`}
      className="w-full"
      role="img"
      aria-label={`How ${totalLabel} splits across ${visible.length} services`}
    >
      {/* Ribbons under everything */}
      {visible.map((item, i) => {
        const y = i * ROW_H + ROW_H / 2 + 12
        const w = total > 0 ? Math.max(2.5, (item.amount / total) * maxRibbon * Math.min(visible.length, 6)) : 2.5
        const path = link({ source: [LEFT_X, sourceY], target: [RIGHT_X, y] }) ?? ''
        return (
          <path
            key={item.departmentId}
            d={path}
            fill="none"
            stroke={slotColor(item.colorSlot)}
            strokeWidth={Math.min(w, maxRibbon)}
            strokeOpacity={0.65}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={drawn ? 0 : 1}
            style={{ transition: `stroke-dashoffset 700ms ease ${i * 60}ms` }}
          />
        )
      })}

      {/* Source node */}
      <g>
        <rect x={8} y={sourceY - 26} width={LEFT_X - 8} height={52} rx={10} fill="#0b0b0b" />
        <text x={(LEFT_X + 8) / 2} y={sourceY - 5} textAnchor="middle" fill="#ffffff" fontSize={15} fontWeight={700}>
          {totalLabel}
        </text>
        <text x={(LEFT_X + 8) / 2} y={sourceY + 14} textAnchor="middle" fill="#c3c2b7" fontSize={10.5}>
          your city tax / yr
        </text>
      </g>

      {/* Department rows */}
      {visible.map((item, i) => {
        const y = i * ROW_H + ROW_H / 2 + 12
        return (
          <g key={item.departmentId}>
            <circle cx={RIGHT_X + 8} cy={y} r={5} fill={slotColor(item.colorSlot)} stroke="#fcfcfb" strokeWidth={2} />
            <text x={RIGHT_X + 22} y={y + 1} fontSize={13} fontWeight={600} fill="#0b0b0b" dominantBaseline="middle">
              {item.label}
            </text>
            <text x={WIDTH - 8} y={y + 1} textAnchor="end" fontSize={13} fill="#0b0b0b" dominantBaseline="middle" className="tabular">
              {moneyFull(item.amount)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
