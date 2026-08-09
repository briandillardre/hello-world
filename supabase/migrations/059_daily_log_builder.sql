-- 059: admin-configurable daily log + GPS stamps on field events
--
-- companies.log_form  — the admin-built form: ordered items (standard
--                       sections + custom questions), each with enabled/
--                       required flags. NULL = the built-in default form
--                       (identical to the pre-059 hardcoded one).
-- daily_logs.answers  — custom-question answers, self-describing:
--                       [{id, label, value}] so the feed and the AI never
--                       need the form config to read old submissions.
-- lat/lng columns     — where the phone physically was at clock-in and at
--                       log submission; feeds the map's Field activity layer.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS log_form JSONB;

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS in_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS in_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS out_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS out_lng DOUBLE PRECISION;
