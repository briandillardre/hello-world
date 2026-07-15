'use client'

import { useEffect, useRef, useState } from 'react'
import { layoutTreemap, type BudgetNode } from '@/lib/budget'
import { money, pct } from '@/lib/format'
import { slotColor, tint } from '@/lib/palette'

/** Pick ink or white text for readable contrast on a tile fill. */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255)
  return lum > 0.55 ? '#0b0b0b' : '#ffffff'
}

function tileFill(node: BudgetNode, index: number): string {
  if (node.kind === 'fund') return '#f0efec' // funds are identified by label, not hue
  const base = slotColor(node.colorSlot ?? 1)
  if (node.kind === 'department') return base
  // Divisions/lines stay in the parent's hue family, stepped lighter by rank.
  return tint(base, Math.min(0.15 + index * 0.12, 0.6))
}

export function Treemap({
  node,
  onDrill,
  height = 460,
}: {
  node: BudgetNode
  onDrill: (id: string) => void
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const tiles = width > 0 ? layoutTreemap(node, width, height) : []
  const total = node.amount

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      {tiles.map((tile, i) => {
        const fill = tileFill(tile.node, i)
        const ink = textOn(fill)
        const drillable = Boolean(tile.node.children?.length)
        const showLabel = tile.width > 72 && tile.height > 40
        const showAmount = tile.width > 72 && tile.height > 64
        const share = total > 0 ? tile.node.amount / total : 0
        const label = `${tile.node.name}: ${money(tile.node.amount)} (${pct(share)})`
        const Tag = drillable ? 'button' : 'div'
        return (
          <Tag
            key={tile.node.id}
            type={drillable ? 'button' : undefined}
            onClick={drillable ? () => onDrill(tile.node.id) : undefined}
            title={label}
            aria-label={drillable ? `${label} — drill in` : label}
            className={`absolute overflow-hidden rounded-md text-left transition-all duration-300 ${
              drillable ? 'cursor-pointer hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink' : ''
            } ${tile.node.kind === 'fund' ? 'border border-baseline' : ''}`}
            style={{
              left: tile.x,
              top: tile.y,
              width: tile.width,
              height: tile.height,
              backgroundColor: fill,
            }}
          >
            {showLabel && (
              <span className="block px-2 pt-1.5 text-xs font-semibold leading-tight" style={{ color: tile.node.kind === 'fund' ? '#0b0b0b' : ink }}>
                {tile.node.name}
              </span>
            )}
            {showAmount && (
              <span className="tabular block px-2 text-xs" style={{ color: tile.node.kind === 'fund' ? '#52514e' : ink, opacity: 0.9 }}>
                {money(tile.node.amount)} · {pct(share)}
              </span>
            )}
          </Tag>
        )
      })}
    </div>
  )
}
