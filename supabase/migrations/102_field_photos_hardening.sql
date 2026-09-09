-- 102 · Field photos hardening (sec-check on 101, Sep 9 2026).
--
-- 101's "insert own" / "update own" policies checked only company + user, so
-- a member could POST a field_photos row through PostgREST carrying ANY url
-- (a drone shot, a scaled plan, a colleague's log photo) and then remove it
-- with the delete action. Writes now go through the service client only
-- (finalizePhotoAction / clockOutAction / deletePhotoAction set company and
-- user from the session and validate the rest); reads stay company-wide.
DROP POLICY IF EXISTS "field photos: insert own" ON field_photos;
DROP POLICY IF EXISTS "field photos: update own" ON field_photos;
DROP POLICY IF EXISTS "field photos: delete own" ON field_photos;

-- The map ships these rows to every teammate: keep them sane at the table.
ALTER TABLE field_photos DROP CONSTRAINT IF EXISTS field_photos_lat_chk;
ALTER TABLE field_photos DROP CONSTRAINT IF EXISTS field_photos_lng_chk;
ALTER TABLE field_photos DROP CONSTRAINT IF EXISTS field_photos_caption_chk;
ALTER TABLE field_photos DROP CONSTRAINT IF EXISTS field_photos_url_chk;
ALTER TABLE field_photos ADD CONSTRAINT field_photos_lat_chk CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE field_photos ADD CONSTRAINT field_photos_lng_chk CHECK (lng BETWEEN -180 AND 180);
ALTER TABLE field_photos ADD CONSTRAINT field_photos_caption_chk CHECK (caption IS NULL OR length(caption) <= 240);
ALTER TABLE field_photos ADD CONSTRAINT field_photos_url_chk CHECK (length(url) <= 2048 AND url ~ '^https://');

-- The bucket only ever held images (site imagery, plan rasters, receipts,
-- log photos): say so at the storage layer, so a signed URL minted for a
-- JPEG cannot be used to park HTML on our origin. 50 MB = the imagery cap.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'],
    file_size_limit = 52428800
WHERE id = 'field-photos';
