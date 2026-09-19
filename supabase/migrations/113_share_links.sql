-- 113 — share_links + the private `exports` bucket.
--
-- Brian, Sep 19: "GIF won't save to phone. Need share option to send link to
-- show certain screen setup to team members either thru app or thru link."
--
-- Two problems, one table, one short URL shape: hammertrack.ai/x/<id>.
--
-- FILES. Inside the Capacitor shell there is no download door — an
-- <a download> click is a no-op (the host app wires no DownloadListener) and
-- navigator.share is browser chrome the WebView does not have — so the GIF
-- was built every time and then handed to nothing. A finished export (GIF,
-- PNG, PDF) now goes into a PRIVATE bucket through a signed upload URL and
-- what the person gets is a LINK: a signed URL on an external host for Save
-- (the shell hands foreign hosts to the system browser, which downloads it)
-- and the short /x/<id> for a text or an email. File links are public BY
-- LINK on purpose — a replay GIF is meant to reach a client or a claim — so
-- the id is the whole secret (12 chars, 31-letter alphabet, ~2^59) and the
-- link dies in 30 days, object included.
--
-- VIEWS. "This screen": every layer toggle, the camera, the time range and
-- playhead, the followed or selected machine — saved as a row and opened as
-- /map?v=<id>. A view link needs a LOGIN in the same company: it names
-- assets and zones, and the recipient's own row-level security decides what
-- they see of them (111). 180 days.

CREATE TABLE IF NOT EXISTS public.share_links (
  id          TEXT PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('view', 'file')),
  title       TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ,
  opens       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS share_links_company_idx ON public.share_links (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS share_links_expiry_idx  ON public.share_links (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.share_links ENABLE ROW LEVEL SECURITY;

-- Members read their own company's VIEW links — the map page applies one
-- with the caller's client, so RLS is the company check. File links are never
-- read through the API roles: the /x route resolves them with the service
-- client, by id. Every write goes through a server action on the service
-- client after it has checked the caller, so there is no INSERT / UPDATE /
-- DELETE policy at all.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'share_links' AND policyname = 'company view links') THEN
    CREATE POLICY "company view links" ON public.share_links
      FOR SELECT USING (kind = 'view' AND company_id = current_company_id());
  END IF;
END $$;

-- Private bucket for finished exports. No storage.objects policies on
-- purpose: uploads ride a signed upload URL and downloads a signed URL, both
-- minted by the service role. 25 MB is well above the biggest GIF the
-- recorder will make (its size estimate warns past the MMS limit long before).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('exports', 'exports', false, 26214400, ARRAY['image/gif', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;
