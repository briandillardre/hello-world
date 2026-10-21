// Client-safe environment flags. NEXT_PUBLIC_* is inlined at build time, so
// this module works identically in server and client components.

export const isMock =
  !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === "https://your-project.supabase.co";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
