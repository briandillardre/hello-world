import { NextRequest, NextResponse } from 'next/server'

// Trim guards against a stray space/newline pasted into the env var on Vercel.
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()

// Only enforce auth when Supabase is configured with a *valid* https URL.
// A malformed URL (e.g. the dashboard link instead of https://<ref>.supabase.co)
// would otherwise make createServerClient throw and 500 the entire site.
function isValidSupabaseUrl(url: string): boolean {
  if (!url || url === 'https://your-project.supabase.co') return false
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.length > 0
  } catch {
    return false
  }
}

const isSupabaseConfigured = isValidSupabaseUrl(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 0

export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next()

  const response = NextResponse.next()

  // Never let an auth/network hiccup hard-500 every page. If anything in the
  // Supabase session check throws, fall through and let route-level auth decide.
  let user = null
  try {
    const { createServerClient } = await import('@supabase/ssr')
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    })
    const result = await supabase.auth.getUser()
    user = result.data.user
  } catch (err) {
    console.error('[middleware] supabase auth check failed:', err)
    return response
  }

  const pathname = request.nextUrl.pathname

  // Note: /command is intentionally NOT public — with a real database it shows
  // live fleet positions and job costs. (Demo mode never reaches this check.)
  // API routes are public only if they carry their own auth (webhook token /
  // ingest key / OAuth state); everything else under /api requires a session.
  const isPublic = pathname === '/' ||
    pathname.startsWith('/login') || pathname.startsWith('/register') ||
    pathname.startsWith('/pricing') || pathname.startsWith('/demo') ||
    pathname.startsWith('/track') ||
    pathname.startsWith('/api/ingest/') || pathname === '/api/qbo/callback'
  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (user && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/map', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js).*)'],
}
