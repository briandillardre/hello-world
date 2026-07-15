// Validated categorical + status palette (dataviz reference instance, light mode).
// Slot ORDER is the colorblind-safety mechanism — assign in fixed order, never cycle.
// Slots 3 (magenta), 4 (yellow), 5 (aqua) sit below 3:1 on the light surface, so
// every chart using them carries visible direct labels (the relief rule).

export const CATEGORICAL: readonly string[] = [
  '#2a78d6', // 1 blue
  '#008300', // 2 green
  '#e87ba4', // 3 magenta
  '#eda100', // 4 yellow
  '#1baf7a', // 5 aqua
  '#eb6834', // 6 orange
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
]

export function slotColor(slot: number): string {
  return CATEGORICAL[Math.min(Math.max(slot, 1), CATEGORICAL.length) - 1]
}

// Reserved status palette — never reused as series colors; always icon + label.
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

export const CHROME = {
  surface: '#fcfcfb',
  plane: '#f9f9f7',
  inkPrimary: '#0b0b0b',
  inkSecondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
  successText: '#006300',
} as const

// Tint a slot color for child tiles (divisions/line items under a department):
// mix toward the surface so children stay in the parent's hue family.
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const mix = (c: number) => Math.round(c + (252 - c) * amount)
  return `#${[mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}
