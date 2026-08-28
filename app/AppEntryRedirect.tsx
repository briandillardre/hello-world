'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isNativeApp } from '@/lib/native'

/**
 * Inside the native shell, the marketing splash is the wrong first screen —
 * someone who already installed the app does not need a hero, a hamburger,
 * or a "Start free pilot" button (Brian, Aug 28, from a fresh install).
 *
 * `capacitor.config.ts` now points the shell straight at /map, but the Play
 * build has been in production since Aug 21, so every already-installed copy
 * still requests the root. This runs there and bounces them, which ships on
 * the next WEB deploy — no store release, no waiting for anyone to update.
 *
 * /map is the right single destination for both states: the dashboard's auth
 * gate sends a signed-out visitor to /login and a signed-in one straight to
 * the live map.
 *
 * The overlay only ever renders inside the shell, so nothing about the
 * marketing page changes for a real web visitor — including the ad funnel
 * arriving through Facebook's in-app browser, which is also a WebView and
 * must NOT be treated as our app (a user-agent sniff would have caught it).
 */
export function AppEntryRedirect() {
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!isNativeApp()) return
    setLeaving(true)
    router.replace('/map')
  }, [router])

  if (!leaving) return null
  return (
    <div
      // Covers the marketing content for the frame or two before the route
      // swaps, so the app never flashes a splash page at its own user.
      className="fixed inset-0 z-[100] bg-navy-950"
      aria-hidden="true"
    />
  )
}
