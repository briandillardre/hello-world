-- Brain Ball: per-parent cloud storage for kid game profiles.
-- One row per parent account; the payload holds the full profiles array
-- (same shape as the localStorage store, so sync is a straight swap).
--
-- Google sign-in setup (one-time, Supabase dashboard):
--   1. console.cloud.google.com → create OAuth client (web), authorized
--      redirect URI: https://<project-ref>.supabase.co/auth/v1/callback
--   2. Supabase → Authentication → Providers → Google → paste client ID +
--      secret, enable.
--   3. Supabase → Authentication → URL Configuration → add
--      https://hammertrackai.com/play to the redirect allow list.

create table if not exists brainball_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table brainball_profiles enable row level security;

create policy "own brainball profiles - select"
  on brainball_profiles for select
  using (auth.uid() = user_id);

create policy "own brainball profiles - insert"
  on brainball_profiles for insert
  with check (auth.uid() = user_id);

create policy "own brainball profiles - update"
  on brainball_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
