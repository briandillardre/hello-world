-- 138 — Site cameras on a zone (Brian, Oct 19: "needs to be cheap and in our
-- app or at least a link / popup webpage in our app").
--
-- A camera is a NAME + how to open its live view: the maker's phone app
-- (UBox — the 4G PTZ DCG already owns is cloud-only, no RTSP/ONVIF feed to
-- read), or any web link (a camera's own viewer page, a Frigate page later).
-- No video passes through HammerTrack; the row only says where to look.
--
-- Writes are server actions on the service client after the edit check, so
-- members get SELECT only. Prospects read nothing (119). Small, empty table.

CREATE TABLE IF NOT EXISTS public.zone_cameras (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  kind         TEXT NOT NULL CHECK (kind IN ('ubox', 'link')),
  url          TEXT CHECK (url IS NULL OR (char_length(url) <= 500 AND url ~ '^https://')),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT zone_cameras_link_has_url CHECK (kind <> 'link' OR url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS zone_cameras_zone_idx ON public.zone_cameras (geofence_id, created_at);

ALTER TABLE public.zone_cameras ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'zone_cameras' AND policyname = 'company zone cameras read') THEN
    CREATE POLICY "company zone cameras read" ON public.zone_cameras
      FOR SELECT USING (company_id = current_company_id());
  END IF;
END $$;

REVOKE ALL ON public.zone_cameras FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.zone_cameras FROM authenticated;
GRANT SELECT ON public.zone_cameras TO authenticated;

SELECT ht_prospect_lockdown('zone_cameras', false);

NOTIFY pgrst, 'reload schema';
