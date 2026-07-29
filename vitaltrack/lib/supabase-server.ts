import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isMock, DEMO_USER_ID } from "./supabase";

/** Cookie-bound Supabase client for server components and route handlers. */
export function createUserClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: Array<{
            name: string;
            value: string;
            options: CookieOptions;
          }>
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore, middleware not used.
          }
        },
      },
    }
  );
}

/** Returns the signed-in user's id, DEMO_USER_ID in demo mode, or null. */
export async function getUserId(): Promise<string | null> {
  if (isMock) return DEMO_USER_ID;
  const supabase = createUserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
