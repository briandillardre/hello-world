-- 143 — The plan room: sets, files, sheets, versions (Brian, Nov 7: "I really
-- want versions of pdf plans shown and scaled on map (selectable pages,
-- versions, etc.)" and "needs to be obvious which are most recent").
--
--   SET      one issue of drawings with a date: bid set, addendum, IFC.
--   FILE     one PDF of that set, kept whole in the private 'plans' bucket so
--            the sheet viewer renders the real vector page (a set can arrive
--            as several PDFs: civil, landscape, the geotech report).
--   SHEET    a sheet number on a site: C-101. Unique per site (by number_key,
--            so "C-101" and "C101" are one sheet).
--   VERSION  one page of one file that issues that sheet (Rev 0, Rev 1…).
--            Its picture and its placement on the map stay in zone_imagery
--            (kind 'plan', 055) — the map layer, the dirt takeoff and the site
--            page already read them there — and the version points at it.
--
-- CURRENT = plan_sheets.current_version_id when someone pinned one, else the
-- newest live version (issued_on, then created_at). Everything else is
-- superseded and says so.
--
-- Writes go through server actions on the service client after the edit
-- check (the 138 pattern): members get SELECT only, prospects read (plans sit
-- beside zones and imagery on their allow-list, 119), anon nothing.

CREATE TABLE IF NOT EXISTS public.plan_sets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind         TEXT NOT NULL DEFAULT 'bid'
               CHECK (kind IN ('bid', 'addendum', 'ifc', 'revision', 'record', 'other')),
  issued_on    DATE NOT NULL,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS plan_sets_zone_idx ON public.plan_sets (geofence_id, issued_on DESC);

-- The original PDFs (≤ 50 MB each, the project's upload ceiling today).
CREATE TABLE IF NOT EXISTS public.plan_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  set_id       UUID NOT NULL REFERENCES public.plan_sets(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  path         TEXT NOT NULL UNIQUE CHECK (char_length(path) <= 300),
  bytes        BIGINT CHECK (bytes IS NULL OR bytes > 0),
  pages        INT CHECK (pages IS NULL OR pages BETWEEN 1 AND 2000),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS plan_files_set_idx ON public.plan_files (set_id);

CREATE TABLE IF NOT EXISTS public.plan_sheets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  number       TEXT NOT NULL CHECK (char_length(number) BETWEEN 1 AND 24),
  number_key   TEXT NOT NULL CHECK (char_length(number_key) BETWEEN 1 AND 24),
  title        TEXT CHECK (title IS NULL OR char_length(title) <= 200),
  discipline   TEXT CHECK (discipline IS NULL OR char_length(discipline) <= 8),
  -- A full re-issue that left this sheet out, and the person said void it.
  voided_at    TIMESTAMPTZ,
  voided_by_set UUID REFERENCES public.plan_sets(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_sheets_number_uq
  ON public.plan_sheets (geofence_id, number_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.plan_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sheet_id      UUID NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  set_id        UUID REFERENCES public.plan_sets(id) ON DELETE SET NULL,
  file_id       UUID REFERENCES public.plan_files(id) ON DELETE SET NULL,
  -- The rasterized page + its ground corners (zone_imagery, kind 'plan').
  image_id      UUID REFERENCES public.zone_imagery(id) ON DELETE SET NULL,
  page          INT CHECK (page IS NULL OR page BETWEEN 1 AND 2000),
  rev           TEXT CHECK (rev IS NULL OR char_length(rev) <= 8),
  issued_on     DATE NOT NULL,
  -- Hash of the drawing outside the title block — linework and words
  -- (lib/plans/fingerprint.ts): equal hashes = a re-issue with nothing drawn
  -- differently.
  signature     TEXT CHECK (signature IS NULL OR char_length(signature) <= 128),
  -- The page at scale 1 as it is VIEWED (points), and the box the linework
  -- fills on it (x0, y0, x1, y1): same page + same ink box = same plot, so the
  -- placement carries over with no clicks.
  page_w        REAL,
  page_h        REAL,
  ink_box       REAL[] CHECK (ink_box IS NULL OR array_length(ink_box, 1) = 4),
  feet_per_inch REAL CHECK (feet_per_inch IS NULL OR (feet_per_inch > 0 AND feet_per_inch <= 2000)),
  scale_text    TEXT CHECK (scale_text IS NULL OR char_length(scale_text) <= 40),
  -- The scale card's independent measures (stated, bar, labelled distances,
  -- placement, ground) and its verdict.
  scale_checks  JSONB,
  -- The drawing area to show on the map (page fractions; the border and the
  -- title block hide), and details drawn at another scale.
  crop          JSONB,
  viewports     JSONB,
  -- What the title-block reader saw, kept beside what the person confirmed.
  title_read    JSONB,
  -- How it got onto the map: {source: carried|manual|grid|parcel|terrain, errorFt, from}.
  placement     JSONB,
  created_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS plan_versions_sheet_idx
  ON public.plan_versions (sheet_id, issued_on DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS plan_versions_set_idx ON public.plan_versions (set_id);
CREATE INDEX IF NOT EXISTS plan_versions_file_idx ON public.plan_versions (file_id);
CREATE INDEX IF NOT EXISTS plan_versions_image_idx ON public.plan_versions (image_id);

-- A pinned current version (NULL = the newest one).
ALTER TABLE public.plan_sheets
  ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES public.plan_versions(id) ON DELETE SET NULL;

-- NEW dots: the newest version each person has opened, per sheet. Service
-- role only — the loader reads the caller's own rows on the server.
CREATE TABLE IF NOT EXISTS public.plan_seen (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sheet_id    UUID NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  version_id  UUID NOT NULL REFERENCES public.plan_versions(id) ON DELETE CASCADE,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, sheet_id)
);

ALTER TABLE public.plan_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_seen ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plan_sets' AND policyname = 'company plan sets read') THEN
    CREATE POLICY "company plan sets read" ON public.plan_sets
      FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plan_files' AND policyname = 'company plan files read') THEN
    CREATE POLICY "company plan files read" ON public.plan_files
      FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plan_sheets' AND policyname = 'company plan sheets read') THEN
    CREATE POLICY "company plan sheets read" ON public.plan_sheets
      FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'plan_versions' AND policyname = 'company plan versions read') THEN
    CREATE POLICY "company plan versions read" ON public.plan_versions
      FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
  END IF;
END $$;

REVOKE ALL ON public.plan_sets, public.plan_files, public.plan_sheets, public.plan_versions, public.plan_seen FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.plan_sets, public.plan_files, public.plan_sheets, public.plan_versions FROM authenticated;
REVOKE ALL ON public.plan_seen FROM authenticated;
GRANT SELECT ON public.plan_sets, public.plan_files, public.plan_sheets, public.plan_versions TO authenticated;

SELECT ht_prospect_lockdown('plan_sets', true);
SELECT ht_prospect_lockdown('plan_files', true);
SELECT ht_prospect_lockdown('plan_sheets', true);
SELECT ht_prospect_lockdown('plan_versions', true);
SELECT ht_prospect_lockdown('plan_seen', false);

-- Original PDFs: private, read through short signed links after the
-- permission check (the 113 / 127 pattern). 50 MB matches the project's
-- upload ceiling; bigger sets still come in as pictures.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('plans', 'plans', false, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Adopt what is already uploaded: one "Earlier uploads" set per site with
-- plan sheets, and one sheet + Rev 0 per sheet picture, so nothing uploaded
-- before today goes missing. Numbers are placeholders (P-1, P-2…) to rename.
INSERT INTO public.plan_sets (company_id, geofence_id, name, kind, issued_on)
SELECT zi.company_id, zi.geofence_id, 'Earlier uploads', 'other', MIN(zi.taken_on)
FROM public.zone_imagery zi
WHERE zi.kind = 'plan'
  AND NOT EXISTS (SELECT 1 FROM public.plan_sets ps WHERE ps.geofence_id = zi.geofence_id AND ps.name = 'Earlier uploads')
GROUP BY zi.company_id, zi.geofence_id;

WITH numbered AS (
  SELECT zi.id, zi.company_id, zi.geofence_id, zi.taken_on, zi.plan_category, zi.caption,
         zi.bounds IS NOT NULL AS placed,
         ROW_NUMBER() OVER (PARTITION BY zi.geofence_id ORDER BY zi.created_at, zi.id) AS n
  FROM public.zone_imagery zi
  WHERE zi.kind = 'plan'
    AND NOT EXISTS (SELECT 1 FROM public.plan_versions pv WHERE pv.image_id = zi.id)
), sheets AS (
  INSERT INTO public.plan_sheets (company_id, geofence_id, number, number_key, title)
  SELECT company_id, geofence_id, 'P-' || n, 'P' || n,
         left(coalesce(plan_category, 'Plan') || coalesce(' · ' || caption, ''), 200)
  FROM numbered
  ON CONFLICT DO NOTHING
  RETURNING id, geofence_id, number_key
)
INSERT INTO public.plan_versions (company_id, sheet_id, set_id, image_id, issued_on, rev, placement)
SELECT nb.company_id, s.id, ps.id, nb.id, nb.taken_on, '0',
       CASE WHEN nb.placed THEN jsonb_build_object('source', 'manual') END
FROM numbered nb
JOIN sheets s ON s.geofence_id = nb.geofence_id AND s.number_key = 'P' || nb.n
JOIN public.plan_sets ps ON ps.geofence_id = nb.geofence_id AND ps.name = 'Earlier uploads' AND ps.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
