import { NextRequest, NextResponse } from 'next/server'

// Only enforce auth when Supabase is configured
const isSupabaseConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://your-project.supabase.co'

export async function middleware(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next()

  const { createServerClient } = await import('@supabase/ssr')
  const response = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const pathname = request.nextUrl.pathname

  // Note: /command is intentionally NOT public — with a real database it shows
  // live fleet positions and job costs. (Demo mode never reaches this check.)
  // API routes are public only if they carry their own auth (webhook token /
  // ingest key / OAuth state); everything else under /api requires a session.
  const isPublic = pathname === '/' ||
    pathname.startsWith('/login') || pathname.startsWith('/register') ||
    pathname.startsWith('/pricing') || pathname.startsWith('/demo') ||
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
