'use client'

/**
 * The ONE search-and-sort convention for every list page (Assets, Zones,
 * Maintenance, Accounting…): a magnifier search box + amber sort pills.
 * "Assets, zones, etc. should all be searchable and sortable … Accounting,
 * maintenance, etc. should feel similar" (owner, Jul 31).
 */

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export function SearchInput({ value, onChange, placeholder = 'Search…' }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative flex-1 min-w-[160px]">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
      <Input
        placeholder={placeholder}
        className="pl-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function SortPills<K extends string>({ options, value, onChange }: {
  options: [K, string][]
  value: K
  onChange: (k: K) => void
}) {
  return (
    <div className="flex gap-1.5 flex-none">
      {options.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={
            'px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ' +
            (value === k ? 'bg-amber text-[#1a1100]' : 'bg-navy-800 text-muted hover:bg-navy-700')
          }
        >
          {label}
        </button>
      ))}
    </div>
  )
}
