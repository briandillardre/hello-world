/**
 * System monitoring notifier — pushes OPERATIONAL problems (crashes, dead
 * feeds, silent trackers) to the owner's existing ntfy channel. Separate
 * voice from theft/site alerts: title "SYSTEM", wrench tag, so a 2 AM page
 * about a webhook is never confused with a 2 AM page about an excavator.
 *
 * Dedupes in-module: the same problem notifies at most once per hour per
 * lambda instance, and at most 20 system pushes a day — a crash loop
 * becomes one push, not five hundred.
 */

const sentAt = new Map<string, number>()
let dayCount = 0
let dayStart = 0

const DEDUPE_MS = 60 * 60_000
const DAY_CAP = 20

export async function notifySystem(title: string, body: string): Promise<void> {
  const url = process.env.NOTIFY_WEBHOOK_URL
  if (!url) return
  const now = Date.now()
  if (now - dayStart > 86_400_000) { dayStart = now; dayCount = 0 }
  if (dayCount >= DAY_CAP) return
  const key = `${title}|${body.slice(0, 120)}`
  const last = sentAt.get(key)
  if (last && now - last < DEDUPE_MS) return
  sentAt.set(key, now)
  if (sentAt.size > 200) sentAt.clear()
  dayCount++
  try {
    if (/(^|\/\/|\.)ntfy\./.test(url) || url.includes('ntfy.sh/')) {
      // ASCII-only headers — an emoji in Title makes fetch throw (learned
      // the hard way in lib/notify.ts); ntfy renders emoji from Tags.
      await fetch(url, {
        method: 'POST',
        headers: { Title: `SYSTEM: ${title}`.slice(0, 120), Priority: 'high', Tags: 'wrench' },
        body: body.slice(0, 800),
        signal: AbortSignal.timeout(8000),
      })
      return
    }
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'system', title, body, at: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    // Monitoring must never take the app down with it.
  }
}
