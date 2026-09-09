/**
 * Only an https URL — and, when we know our storage host, only ours — may go
 * into an <img src> / <a href> the whole company sees (sec-check, Sep 9: a
 * member-writable daily_logs.photos[].url reached a link). Anything else → null.
 */
export function safeHttps(u: unknown, opts: { ourHostOnly?: boolean } = {}): string | null {
  if (typeof u !== 'string' || u.length > 2048) return null
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:') return null
    if (opts.ourHostOnly) {
      const own = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null
      if (own && url.host !== own) return null
    }
    return url.href
  } catch { return null }
}
