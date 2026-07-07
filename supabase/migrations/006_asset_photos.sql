-- Asset photo storage.
--
-- Photos upload through a server action using the service-role key (which
-- bypasses storage RLS), into a PUBLIC bucket so assets.photo_url can be a
-- plain public URL the <img> tag renders without signed-URL churn.
--
-- No INSERT/UPDATE/DELETE policies are created on storage.objects for this
-- bucket: with none present, anon/authenticated clients cannot write to it —
-- only the server (service role) can. Object paths are namespaced by company:
--   asset-photos/{company_id}/{uuid}.jpg

INSERT INTO storage.buckets (id, name, public)
VALUES ('asset-photos', 'asset-photos', true)
ON CONFLICT (id) DO NOTHING;
