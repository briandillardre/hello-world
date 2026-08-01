-- 046: per-project (per-zone) project management — the Project Hub.
--
-- Zone = project = QBO customer (the 037 single-source-of-truth rule), so PM
-- lives ON the zone: punch-list tasks, milestones, and a budget the tracked
-- actuals burn against. Deep-dive + scope rationale: docs/PROJECT-MANAGEMENT.md
-- (short version: small GCs run jobs on group texts + a spreadsheet; they need
-- Fieldwire's punch list and a schedule strip, not Procore's RFIs).

-- What the job should cost. Actuals come from tracked equipment hours +
-- job-coded receipts, which HammerTrack already accrues automatically.
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS budget NUMERIC(12,2);

-- Punch list / tasks. Deliberately flat — no subtasks, no swimlanes: a
-- foreman works a checklist, not a kanban board.
CREATE TABLE IF NOT EXISTS project_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  priority     TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  assignee_id  UUID,                 -- team member (profiles.id)
  due_date     DATE,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS project_tasks_zone_idx ON project_tasks(geofence_id, status, created_at DESC);

ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company project tasks" ON project_tasks;
CREATE POLICY "company project tasks" ON project_tasks
  FOR ALL USING (company_id = current_company_id());

-- Milestones: the schedule strip. Target date + done flag — a small GC's
-- schedule is ten dated line items, not a Gantt dependency graph.
CREATE TABLE IF NOT EXISTS project_milestones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  target_date  DATE,
  done_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS project_milestones_zone_idx ON project_milestones(geofence_id, target_date);

ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company project milestones" ON project_milestones;
CREATE POLICY "company project milestones" ON project_milestones
  FOR ALL USING (company_id = current_company_id());

-- Rebuild the GeoJSON view so budget reaches the zone pages/panels.
DROP VIEW IF EXISTS geofences_json;
CREATE VIEW geofences_json
WITH (security_invoker = true) AS
SELECT
  id, company_id, owner_id, name, color, parent_id, kind, notes,
  folder_url, completed_at, qbo_customer_id, budget, active_from, active_until, created_at,
  ST_AsGeoJSON(geometry)::jsonb AS geometry
FROM geofences;
