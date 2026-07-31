-- Client branding: the company's own logo (Settings → Company). Shown at the
-- top of the app sidebar and on every PDF the app generates (map snapshots,
-- fleet reports…). Stored in the public asset-photos bucket.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
