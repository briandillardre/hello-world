-- Asset categories, serial numbers, and photos.
-- category: free-form grouping ("Dozers", "Pickups", "Crew A") — acts like a folder.
-- serial:   serial / VIN / asset tag.
-- photo_url: link to an asset photo (Supabase Storage or any URL).

ALTER TABLE assets ADD COLUMN IF NOT EXISTS category  TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS serial    TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS photo_url TEXT;

CREATE INDEX IF NOT EXISTS assets_category_idx ON assets(company_id, category) WHERE category IS NOT NULL;
