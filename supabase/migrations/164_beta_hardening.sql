-- 164 — The review pass on 162 (Beta) and 163 (site survey), Nov 19.
--
-- 1. Pay follows the ladder. 162 let anyone with the costs ability read every
--    `worker_class` row — a person's base rate, fringe and ID last four. A
--    RESTRICTIVE read policy now adds 134's people ladder on top: your own
--    row, or a person you outrank (`ht_can_see_person`: yourself; anyone
--    strictly below you in your company; nobody outranks the Master; someone
--    no longer on the roster is the Master's alone). The payroll page applies
--    the same cut to the EFFECTIVE login (RLS sees the real one, not view-as).
-- 2. Beta records follow asset visibility (111): a record on a machine hidden
--    from you (an inspection, an ownership sheet) is hidden with it — the
--    EXISTS runs under the caller's own RLS on assets, so the ladder is decided
--    in one place.
-- 3. A deleted dirt takeoff's versions are gone too: 163's read policy only
--    checked the version's own deleted_at. The EXISTS runs under 128's read
--    policy on dirt_takeoffs, which hides soft-deleted takeoffs.
--
-- Policies only — nothing reads or rewrites a row at deploy. Idempotent
-- (DROP POLICY IF EXISTS / CREATE). Frozen once pushed: fix-ups go in a new file.

-- ── 1. worker_class rows: the person, or someone above them ────────────────
DROP POLICY IF EXISTS "pay follows the ladder" ON public.beta_records;
CREATE POLICY "pay follows the ladder" ON public.beta_records AS RESTRICTIVE FOR SELECT
  USING (kind <> 'worker_class' OR person_id = auth.uid() OR ht_can_see_person(person_id));

-- ── 2. records on a machine follow the machine's visibility ────────────────
DROP POLICY IF EXISTS "follows asset visibility" ON public.beta_records;
CREATE POLICY "follows asset visibility" ON public.beta_records AS RESTRICTIVE FOR SELECT
  USING (asset_id IS NULL OR EXISTS (SELECT 1 FROM public.assets a WHERE a.id = beta_records.asset_id));

-- ── 3. versions of a deleted takeoff are gone with it ──────────────────────
DROP POLICY IF EXISTS "members read" ON public.dirt_takeoff_versions;
CREATE POLICY "members read" ON public.dirt_takeoff_versions FOR SELECT USING (
  company_id = current_company_id() AND deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM public.dirt_takeoffs t WHERE t.id = dirt_takeoff_versions.takeoff_id)
);

NOTIFY pgrst, 'reload schema';
