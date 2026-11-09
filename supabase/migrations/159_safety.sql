-- 159 — Safety: toolbox talks the crew signs on the phone, and incident /
-- near-miss / observation reports from the field (Brian, Nov 9, of the HCSS
-- ad: "Make sure we are beating hcss on our features, cleanliness, and ease
-- of use"). HCSS runs safety meetings with signatures, incidents and JHAs
-- inside HeavyJob — with JHAs iPad-only. Here every piece is a phone form on
-- the same login the crew already clocks in with.
--
-- SAFETY_TALKS: one toolbox talk — topic, site, who led it, notes.
-- SAFETY_SIGNATURES: one row per crew member who signed it (finger-drawn
--   signature as a compact SVG path, or a typed name for a guest).
-- SAFETY_REPORTS: incident / near-miss / observation — what happened, where,
--   injury and treatment, actions taken, open → closed.
--
-- No money anywhere: members read their company's talks; a report (it names people and injuries) is read by Foreman and up, or by whoever filed it. Writes:
-- lib/actions/safety.ts on the service role after the session checks — any
-- login with Daily logs open can lead a talk, sign one or file a report (a
-- near miss reported by the newest hand is the one that matters); closing a
-- report is Foreman and up. An injury report pages the company's phones at
-- once, on the alerts switch, like the daily log's safety field.

CREATE TABLE IF NOT EXISTS public.safety_talks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID REFERENCES public.geofences(id) ON DELETE SET NULL,
  held_on      DATE NOT NULL,
  topic_key    TEXT CHECK (topic_key IS NULL OR char_length(topic_key) <= 40),
  topic        TEXT NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 160),
  notes        TEXT CHECK (notes IS NULL OR char_length(notes) <= 4000),
  led_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS safety_talks_company_idx ON public.safety_talks (company_id, held_on DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.safety_signatures (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  talk_id     UUID NOT NULL REFERENCES public.safety_talks(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- finger-drawn: an SVG path "M1 2L3 4…" in a 300×100 box, capped
  signature   TEXT CHECK (signature IS NULL OR (char_length(signature) <= 12000 AND signature ~ '^[MLml0-9 .,-]+$')),
  signed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- a login signs a talk once; guests (no login) sign by name
CREATE UNIQUE INDEX IF NOT EXISTS safety_signatures_user_uq ON public.safety_signatures (talk_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS safety_signatures_talk_idx ON public.safety_signatures (talk_id);

CREATE TABLE IF NOT EXISTS public.safety_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID REFERENCES public.geofences(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('incident', 'near_miss', 'observation')),
  occurred_at  TIMESTAMPTZ NOT NULL,
  what         TEXT NOT NULL CHECK (char_length(what) BETWEEN 1 AND 4000),
  injury       BOOLEAN NOT NULL DEFAULT false,
  treatment    TEXT NOT NULL DEFAULT 'none' CHECK (treatment IN ('none', 'first_aid', 'medical', 'lost_time')),
  people       TEXT CHECK (people IS NULL OR char_length(people) <= 500),
  actions      TEXT CHECK (actions IS NULL OR char_length(actions) <= 4000),
  lat          DOUBLE PRECISION CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng          DOUBLE PRECISION CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  reported_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at    TIMESTAMPTZ,
  close_note   TEXT CHECK (close_note IS NULL OR char_length(close_note) <= 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS safety_reports_company_idx ON public.safety_reports (company_id, occurred_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.safety_talks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read" ON public.safety_talks;
CREATE POLICY "members read" ON public.safety_talks FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "members read" ON public.safety_signatures;
CREATE POLICY "members read" ON public.safety_signatures FOR SELECT USING (company_id = current_company_id());
-- reports name people and injuries: the crew reads its OWN reports, Foreman and up read all
DROP POLICY IF EXISTS "members read" ON public.safety_reports;
CREATE POLICY "members read" ON public.safety_reports FOR SELECT USING (
  company_id = current_company_id() AND deleted_at IS NULL
  AND (ht_viewer_rank() >= 1 OR reported_by = auth.uid())
);

REVOKE ALL ON public.safety_talks, public.safety_signatures, public.safety_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.safety_talks, public.safety_signatures, public.safety_reports FROM authenticated;
GRANT SELECT ON public.safety_talks, public.safety_signatures, public.safety_reports TO authenticated;
SELECT ht_prospect_lockdown('safety_talks', false);
SELECT ht_prospect_lockdown('safety_signatures', false);
SELECT ht_prospect_lockdown('safety_reports', false);
