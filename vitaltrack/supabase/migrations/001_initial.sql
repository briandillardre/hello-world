-- VitalTrack 001: full schema with RLS.
-- Run in the Supabase SQL Editor (or via psql with SUPABASE_DB_URL).

create extension if not exists pgcrypto;

-- ── Profiles ────────────────────────────────────────────────────────────
create table if not exists profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  dob date,
  sex text check (sex in ('male', 'female', 'other')),
  height_cm numeric,
  created_at timestamptz not null default now()
);

-- ── Wearable data ───────────────────────────────────────────────────────
create table if not exists metric_samples (
  user_id uuid not null references auth.users (id) on delete cascade,
  ts timestamptz not null,
  type text not null,
  value numeric not null,
  source text not null default 'manual',
  primary key (user_id, ts, type)
);
create index if not exists metric_samples_user_type_ts
  on metric_samples (user_id, type, ts desc);

create table if not exists sleep_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  deep_s integer not null default 0,
  light_s integer not null default 0,
  rem_s integer not null default 0,
  awake_s integer not null default 0,
  score integer,
  source text not null default 'manual',
  unique (user_id, start_ts)
);
create index if not exists sleep_sessions_user_end
  on sleep_sessions (user_id, end_ts desc);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  start_ts timestamptz not null,
  type text not null default 'workout',
  duration_s integer not null default 0,
  distance_m numeric,
  avg_hr numeric,
  max_hr numeric,
  calories numeric,
  fit_path text,
  source text not null default 'manual',
  unique (user_id, start_ts)
);

-- ── Health record ───────────────────────────────────────────────────────
create table if not exists conditions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null default 'condition'
    check (kind in ('injury', 'condition', 'surgery', 'family_history')),
  onset date,
  resolved_at date,
  status text not null default 'active'
    check (status in ('active', 'managed', 'resolved')),
  severity integer check (severity between 1 and 5),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  dose text,
  kind text not null default 'medication'
    check (kind in ('medication', 'supplement')),
  started date,
  stopped date,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  metric text,
  target_value numeric,
  direction text check (direction in ('above', 'below')),
  deadline date,
  status text not null default 'active'
    check (status in ('active', 'achieved', 'abandoned')),
  notes text,
  created_at timestamptz not null default now()
);

-- ── Labs ────────────────────────────────────────────────────────────────
create table if not exists lab_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_lab text,
  collected_at date,
  file_path text,
  parsed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists biomarkers (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references lab_reports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  loinc text,
  value numeric not null,
  unit text,
  ref_low numeric,
  ref_high numeric,
  collected_at date
);
create index if not exists biomarkers_user_name
  on biomarkers (user_id, name, collected_at);

-- ── Timeline + AI + integrations ────────────────────────────────────────
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ts timestamptz not null,
  kind text not null,
  title text not null,
  detail text
);
create index if not exists events_user_ts on events (user_id, ts desc);

create table if not exists ai_digests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_of date not null,
  content text not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_of)
);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  external_user_id text not null,
  status text not null default 'connected',
  created_at timestamptz not null default now(),
  unique (provider, external_user_id)
);

-- ── RLS: users see only their own rows ─────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'metric_samples', 'sleep_sessions', 'activities',
    'conditions', 'medications', 'goals', 'lab_reports', 'biomarkers',
    'events', 'ai_digests', 'integrations'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'drop policy if exists %I on %I',
      t || '_own_rows', t
    );
    execute format(
      'create policy %I on %I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_own_rows', t
    );
  end loop;
end $$;
