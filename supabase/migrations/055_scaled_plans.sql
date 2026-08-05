-- 055: Scaled Plans — PDF/plan-sheet overlays join the zone_imagery model.
--
-- Aerials, site photos, and plan sheets are all the same thing: a
-- georeferenced, dated overlay (bounds = 4 ground corners, 053). `kind`
-- switches behavior:
--   photo — the dated site-imagery timeline; the map's Site imagery layer
--           plays these back against the scrubber (newest ≤ scrub date).
--   plan  — a rasterized plan sheet (Existing / Site plan / Utilities /
--           Grading / Landscape…). Plans are timeless; per zone exactly ONE
--           plan may be marked map_active (radio behavior, enforced in the
--           action) and it renders under the map's Scaled plans toggle.

ALTER TABLE zone_imagery ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'photo'
  CHECK (kind IN ('photo', 'plan'));
ALTER TABLE zone_imagery ADD COLUMN IF NOT EXISTS plan_category TEXT;
ALTER TABLE zone_imagery ADD COLUMN IF NOT EXISTS map_active BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS zone_imagery_kind_idx ON zone_imagery(company_id, kind);
