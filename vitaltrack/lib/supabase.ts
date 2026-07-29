import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Demo mode: app works fully with zero env vars (same pattern as HammerTrack).
export const isMock =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === "https://your-project.supabase.co";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

/** Service-role client for webhook/ingest routes. Never import from client components. */
export function createServiceClient(): SupabaseClient {
  if (isMock) throw new Error("Service client unavailable in demo mode");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
