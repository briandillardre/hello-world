'use client'

import { useEffect } from 'react'

/** Reports the browser's IANA timezone to the server via cookie so
 *  server-rendered "Today"/"Yesterday" windows use the viewer's midnight. */
export function TzCookie() {
  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz && !document.cookie.includes(`ht_tz=${tz}`)) {
        document.cookie = `ht_tz=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`
      }
    } catch { /* no tz — server falls back to Eastern */ }
  }, [])
  return null
}
