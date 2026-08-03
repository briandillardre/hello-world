import Link from 'next/link'
import { Map } from 'lucide-react'
import { BRAND_NAME } from '@/lib/brand'

export default function Home() {
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-amber">{BRAND_NAME}</p>
        <h1 className="font-display font-bold text-3xl">The starter is running.</h1>
        <p className="text-sm text-muted">
          Next.js 14 + Tailwind dark theme + Supabase helpers + a MapLibre map with free
          basemaps and live weather radar. Delete this page and build.
        </p>
        <Link
          href="/map"
          className="inline-flex items-center gap-2 rounded-xl bg-amber text-[#1a1100] font-display font-bold px-5 py-3"
        >
          <Map className="h-4 w-4" /> Open the map
        </Link>
      </div>
    </main>
  )
}
