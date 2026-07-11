'use server'

import { redirect } from 'next/navigation'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Sign the user out and return them to the marketing home / login. */
export async function signOutAction() {
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
