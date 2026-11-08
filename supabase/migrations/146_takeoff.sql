-- 146 — Takeoff on the sheets (Plans & Takeoff phase 2; Brian, Nov 7:
-- "Ideally ai does the takeoff and completes all of the typical stuff …
-- needs to tie in with Google sheets and excel for the takeoffs").
--
--   ITEM      the company's item library (Bluebeam's Tool Chest): a code that
--             never changes (PAV-HD), a name, how it is measured, its unit,
--             its colour, its price (behind the costs permission), waste, and
--             the section depth the dirt takeoff deducts.
--   MARK      one measured shape on one VERSION of a sheet, stored on the
--             paper as page fractions (u, v — v down from the top edge) so it
--             reads the same on the PDF and on the picture. Its quantity is
--             measured at the sheet's own scale on the server.
--   SNAPSHOT  the takeoff frozen when the bid goes out ("Bid · Rev 0") — the
--             revision report compares against it.
--   LINK      a private, revocable CSV link per site for Google Sheets
--             IMPORTDATA / Excel Power Query. Service role only.
--   MEMO      the bid memo (quantities, assumptions, risks, questions,
--             exclusions) drafted by the AI from the takeoff, approved by a
--             person.
--
-- Writes go through server actions on the service client after the edit
-- check (the 138 / 143 pattern). Prices never leave the server for a login
-- without the costs ability: members cannot read takeoff_items.unit_price
-- (column grants, the 134 pattern).

CREATE TABLE IF NOT EXISTS public.takeoff_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9.\-]{0,15}$'),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  measure     TEXT NOT NULL CHECK (measure IN ('length', 'area', 'perimeter', 'count', 'volume')),
  unit        TEXT NOT NULL CHECK (unit IN ('LF', 'SF', 'SY', 'AC', 'EA', 'CY', 'TON')),
  color       TEXT NOT NULL DEFAULT '#ff9e16' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  unit_price  NUMERIC(14, 4) CHECK (unit_price IS NULL OR unit_price >= 0),
  waste_pct   REAL NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 100),
  -- Volume items: depth of the material. Area items with a section
  -- (asphalt on stone): the depth below finished grade the dirt takeoff deducts.
  depth_in    REAL CHECK (depth_in IS NULL OR (depth_in > 0 AND depth_in <= 240)),
  tons_per_cy REAL CHECK (tons_per_cy IS NULL OR (tons_per_cy > 0 AND tons_per_cy <= 5)),
  section     TEXT CHECK (section IS NULL OR char_length(section) <= 40),
  sort        INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS takeoff_items_code_uq
  ON public.takeoff_items (company_id, code) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.plan_marks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sheet_id     UUID NOT NULL REFERENCES public.plan_sheets(id) ON DELETE CASCADE,
  version_id   UUID NOT NULL REFERENCES public.plan_versions(id) ON DELETE CASCADE,
  item_id      UUID REFERENCES public.takeoff_items(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('line', 'area', 'count')),
  -- {pts: [[u, v], …], holes?: [[[u, v], …]]} — page fractions.
  geom         JSONB NOT NULL,
  qty          REAL,
  -- ok · check (carried onto a revision whose drawing changed) · suggested (the AI's first pass)
  status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'check', 'suggested')),
  label        TEXT CHECK (label IS NULL OR char_length(label) <= 120),
  carried_from UUID REFERENCES public.plan_marks(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS plan_marks_version_idx ON public.plan_marks (version_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS plan_marks_sheet_idx ON public.plan_marks (sheet_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.takeoff_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  kind         TEXT NOT NULL DEFAULT 'bid' CHECK (kind IN ('bid', 'other')),
  -- {items: [{code, name, unit, qty}], sheets: [{number, rev, versionId}]} — quantities only, never prices.
  data         JSONB NOT NULL,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS takeoff_snapshots_zone_idx ON public.takeoff_snapshots (geofence_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.takeoff_links (
  token          TEXT PRIMARY KEY CHECK (token ~ '^[A-Za-z0-9]{24,40}$'),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id    UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  include_costs  BOOLEAN NOT NULL DEFAULT false,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS takeoff_links_zone_idx ON public.takeoff_links (geofence_id);

CREATE TABLE IF NOT EXISTS public.bid_memos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  geofence_id  UUID NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (char_length(body) <= 40000),
  -- What the draft was written from (the audit trail, like the owner memo's).
  facts        JSONB,
  model        TEXT CHECK (model IS NULL OR char_length(model) <= 60),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at  TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bid_memos_zone_idx ON public.bid_memos (geofence_id, created_at DESC);

ALTER TABLE public.takeoff_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.takeoff_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.takeoff_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_memos ENABLE ROW LEVEL SECURITY;

-- A takeoff follows its site the way the plan room does (144): a personal
-- zone's marks, snapshots and memo are its owner's only.
DROP POLICY IF EXISTS "company takeoff items read" ON public.takeoff_items;
CREATE POLICY "company takeoff items read" ON public.takeoff_items
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "company plan marks read" ON public.plan_marks;
CREATE POLICY "company plan marks read" ON public.plan_marks
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.plan_sheets s JOIN public.geofences g ON g.id = s.geofence_id
                WHERE s.id = plan_marks.sheet_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));
DROP POLICY IF EXISTS "company takeoff snapshots read" ON public.takeoff_snapshots;
CREATE POLICY "company takeoff snapshots read" ON public.takeoff_snapshots
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = takeoff_snapshots.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));
DROP POLICY IF EXISTS "company bid memos read" ON public.bid_memos;
CREATE POLICY "company bid memos read" ON public.bid_memos
  FOR SELECT USING (
    company_id = current_company_id() AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.geofences g
                WHERE g.id = bid_memos.geofence_id AND (g.owner_id IS NULL OR g.owner_id = auth.uid())));

REVOKE ALL ON public.takeoff_items, public.plan_marks, public.takeoff_snapshots, public.takeoff_links, public.bid_memos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.takeoff_items, public.plan_marks, public.takeoff_snapshots, public.bid_memos FROM authenticated;
REVOKE ALL ON public.takeoff_links FROM authenticated;
GRANT SELECT ON public.plan_marks, public.takeoff_snapshots, public.bid_memos TO authenticated;

-- Every column of the item library but its price (the 134 pattern: derived
-- from the catalogue, so a column added later is readable unless named here).
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.takeoff_items'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'unit_price';
  REVOKE SELECT ON TABLE public.takeoff_items FROM authenticated;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.takeoff_items TO authenticated', v_cols);
END $$;

SELECT ht_prospect_lockdown('takeoff_items', true);
SELECT ht_prospect_lockdown('plan_marks', true);
SELECT ht_prospect_lockdown('takeoff_snapshots', true);
SELECT ht_prospect_lockdown('takeoff_links', false);
-- A bid's risks and questions are the company's own business.
SELECT ht_prospect_lockdown('bid_memos', false);

NOTIFY pgrst, 'reload schema';
