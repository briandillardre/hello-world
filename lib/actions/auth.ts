'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Sign the user out and return them to the marketing home / login. */
export async function signOutAction() {
  // A view-as preview must not outlive the session on a shared tablet.
  try { cookies().set('ht_view_as', '', { path: '/', maxAge: 0 }) } catch { /* not in a request */ }
  if (!isMock) {
    try {
      const { createClient } = await import('@/lib/supabase-server')
      await createClient().auth.signOut()
    } catch {
      /* already signed out / transient — fall through to redirect */
    }
    redirect('/login')
  }
  redirect('/')
}
