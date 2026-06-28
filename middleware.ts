import { NextRequest, NextResponse } from 'next/server'

// Trim guards against a stray space/newline pasted into the env var on Vercel.
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()

// Only enforce auth when Supabase is configured with a *valid* https URL.
function isValidSupabaseUrl(url: string): boolean {
  if (!url || url === 'https://your-project.supabase.co') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.length > 0
  } catch {
    return false
  }
}

const isSupabaseConfigured = isValidSupabaseUrl(SUPABASE_URL)

// Supabase stores its session in cookies named `sb-<ref>-auth-token`
// (sometimes chunked: `…-auth-token.0`, `.1`). The middleware only needs to know
// whether a session *exists* so it can redirect — the real session validation
// happens server-side (getUser in server components + Postgres RLS). Checking the
// cookie here keeps the Edge middleware free of the @supabase/ssr import and its
// network call, which is what was throwing MIDDLEWARE_INVOCATION_FAILED.
function hasSupabaseSession(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && c.value.length > 0)
}

export function middleware(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next()

  const pathname = request.nextUrl.pathname
  const loggedIn = hasSupabaseSession(request)

  // Note: /command is intentionally NOT public — with a real database it shows
  // live fleet positions and job costs. (Demo mode never reaches this check.)
  // API routes are public only if they carry their own auth (webhook token /
  // ingest key / OAuth state); everything else under /api requires a session.
  const isPublic =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/demo') ||
    pathname.startsWith('/track') ||
    pathname.startsWith('/api/ingest/') ||
    pathname === '/api/qbo/callback'

  if (!loggedIn && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (loggedIn && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/map', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js).*)'],
}
