import type { NextRequest } from "next/server";

/**
 * CSRF guard for cookie-authenticated mutating route handlers. Next.js only
 * auto-checks Origin for Server Actions, not route handlers, so we verify
 * here: a browser-sent Origin must match, and Sec-Fetch-Site (when present)
 * must be same-origin. Non-browser clients (no such headers) pass — they
 * can't ride a victim's cookies anyway.
 */
export function sameOriginOk(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    // Compare hosts, not full origins — req.nextUrl.origin is unreliable
    // behind proxies/production servers; the Host header is what the
    // browser's same-origin policy keyed the Origin header to.
    try {
      const originHost = new URL(origin).host;
      const host =
        req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      if (!host || originHost !== host) return false;
    } catch {
      return false;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}
