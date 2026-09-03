-- VitalTrack 002: security fixes for databases provisioned from the
-- ORIGINAL 001 file (before commit 754f095). 001 was later amended in
-- place, so fresh installs already include all of this — running 002 is
-- harmless either way (fully idempotent). Always run 001 then 002.

-- 1. integrations must not be client-writable: the original FOR ALL policy
--    let any user claim an arbitrary Junction user id and receive that
--    stream's health data. Replace with select/delete only; rows are
--    created exclusively by the server (service role).
drop policy if exists integrations_own_rows on integrations;
drop policy if exists integrations_select_own on integrations;
create policy integrations_select_own on integrations
  for select to authenticated using (user_id = auth.uid());
drop policy if exists integrations_delete_own on integrations;
create policy integrations_delete_own on integrations
  for delete to authenticated using (user_id = auth.uid());

-- 2. Composite FK so biomarkers can't attach to another user's report
--    (FK validation bypasses RLS).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lab_reports_id_user_id_key'
  ) then
    alter table lab_reports add constraint lab_reports_id_user_id_key
      unique (id, user_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'biomarkers_report_id_user_id_fkey'
  ) then
    -- drop the original single-column FK if present, then add composite
    if exists (
      select 1 from pg_constraint where conname = 'biomarkers_report_id_fkey'
    ) then
      alter table biomarkers drop constraint biomarkers_report_id_fkey;
    end if;
    alter table biomarkers add constraint biomarkers_report_id_user_id_fkey
      foreign key (report_id, user_id)
      references lab_reports (id, user_id) on delete cascade;
  end if;
end $$;

-- 3. Webhook replay-protection table (service-role only).
create table if not exists webhook_deliveries (
  svix_id text primary key,
  received_at timestamptz not null default now()
);
alter table webhook_deliveries enable row level security;

-- 4. Constrain goals.metric (free text originally; it flows into the AI
--    context, so keep it to known metric names at the DB layer too).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'goals_metric_check'
  ) then
    alter table goals add constraint goals_metric_check check (
      metric is null or metric in (
        'steps', 'resting_hr', 'hrv', 'stress', 'body_battery',
        'sleep_score', 'spo2', 'respiration', 'weight', 'calories'
      )
    );
  end if;
end $$;
