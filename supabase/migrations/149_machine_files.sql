-- 149 — Machine files by revision (Plans & Takeoff phase 5; the plan doc's
-- "TP3 files by revision, LandXML/DXF for Linder").
--
-- One row per file a machine runs or a dealer builds from: the Topcon .tp3 the
-- dealer makes, the design LandXML / DXF the dirt takeoff writes for them, a
-- Trimble .svd/.svl/.ttm, a .dwg, a zip of them. Each row remembers the plan
-- versions it was built from (built_from: [{sheetId, versionId}]) so the plan
-- room can say "built from C-101 Rev 1 — Rev 2 is current" the day a revision
-- lands. A file of the same name and kind filed later is the newer one.
--
-- Files live in the private 'machine' bucket at <company>/<id> (any type —
-- machine formats have no MIME of their own — up to 100 MB) and are read back
-- only through short signed links after the permission check.
--
-- Reads: the company, a personal zone's files its owner's only (the 144
-- rule); never a prospect's. Writes: server actions on the service role.

CREATE TABLE IF NOT EXISTS public.machine_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind         TEXT NOT NULL CHECK (kind IN ('tp3', 'tn3', 'svd', 'svl', 'ttm', 'vcl', 'dxf', 'landxml', 'dwg', 'pdf', 'zip', 'other')),
  filename     TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  size_bytes   BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  path         TEXT NOT NULL CHECK (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  built_by     TEXT CHECK (built_by IS NULL OR char_length(built_by) <= 80),
  built_on     DATE,
  built_from   JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(built_from) = 'array' AND jsonb_array_length(built_from) <= 200),
  source       TEXT NOT NULL DEFAULT 'upload' CHECK (source IN ('upload', 'hammertrack')),
  takeoff_id   UUID REFERENCES dirt_takeoffs(id) ON DELETE SET NULL,
  grid         TEXT CHECK (grid IS NULL OR char_length(grid) <= 60),
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS machine_files_zone_idx ON public.machine_files (geofence_id, created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.machine_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company machine files read" ON public.machine_files;
CREATE POLICY "company machine files read" ON public.machine_files
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = machine_files.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

REVOKE ALL ON public.machine_files FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.machine_files FROM authenticated;
GRANT SELECT ON public.machine_files TO authenticated;
SELECT ht_prospect_lockdown('machine_files', false);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('machine', 'machine', false, 104857600, NULL)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
