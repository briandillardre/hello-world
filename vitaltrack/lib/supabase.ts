import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Re-exported for existing server-side imports; client components must
// import from lib/env instead (this module is server-only because it can
// mint a service-role client).
export { isMock, DEMO_USER_ID } from "./env";
import { isMock } from "./env";

/** Service-role client for webhook/ingest routes. Bypasses RLS — never let
 *  values derived from user input choose the user_id it writes to. */
export function createServiceClient(): SupabaseClient {
  if (isMock) throw new Error("Service client unavailable in demo mode");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
