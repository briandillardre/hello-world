-- 165 — pricing from what you pay and what you win (the DCG brief, Nov 25:
-- "help contractors price through winning bids"). Two tables, one bucket:
--
--  supplier_invoices — a quarry / plant / supplier invoice or ticket read off
--    its PDF or photo: header (vendor, number, dates, freight, fuel, tax,
--    total), the lines (material, qty, unit, unit price), the job it was for,
--    and whether it is paid. Filing one updates the cost book's dated prices
--    and, with a site, the job's cost. One live row per vendor + invoice
--    number (the duplicate check). Costs-only reads.
--
--  bid_items — every priced line of every bid: frozen from an estimate when it
--    is sent / won / lost, or pasted from an old bid sheet. Our unit price,
--    the result, the low bid's unit price when known. unit_cost is the
--    company's margin made visible, so members never read that column (the
--    146 column-grant pattern); Admins read it through the server.
--
-- Both: members SELECT only (writes on the service role after the session
-- checks), anon nothing, prospects nothing.

CREATE TABLE IF NOT EXISTS public.supplier_invoices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  place_id       UUID REFERENCES public.places(id) ON DELETE SET NULL,
  geofence_id    UUID REFERENCES geofences(id) ON DELETE SET NULL,
  vendor_name    TEXT NOT NULL CHECK (char_length(vendor_name) BETWEEN 1 AND 120),
  invoice_no     TEXT CHECK (invoice_no IS NULL OR char_length(invoice_no) <= 60),
  invoice_on     DATE,
  due_on         DATE,
  freight        NUMERIC(14, 2) CHECK (freight IS NULL OR abs(freight) <= 100000000),
  fuel           NUMERIC(14, 2) CHECK (fuel IS NULL OR abs(fuel) <= 100000000),
  tax            NUMERIC(14, 2) CHECK (tax IS NULL OR abs(tax) <= 100000000),
  total          NUMERIC(14, 2) CHECK (total IS NULL OR abs(total) <= 100000000),
  -- [{description, materialId, qty, unit, unitPrice, amount, ticket}]
  lines          JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(lines) = 'array' AND pg_column_size(lines) < 200000),
  status         TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'filed')),
  file_path      TEXT CHECK (file_path IS NULL OR file_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  file_name      TEXT CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  read_by        TEXT CHECK (read_by IS NULL OR read_by IN ('ai', 'typed')),
  paid_on        DATE,
  paid_amount    NUMERIC(14, 2) CHECK (paid_amount IS NULL OR abs(paid_amount) <= 100000000),
  note           TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS supplier_invoices_company_idx ON public.supplier_invoices (company_id, invoice_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS supplier_invoices_zone_idx ON public.supplier_invoices (geofence_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoices_dupe_uq ON public.supplier_invoices (company_id, lower(vendor_name), lower(invoice_no))
  WHERE deleted_at IS NULL AND invoice_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bid_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  estimate_id     UUID REFERENCES public.estimates(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('estimate', 'import')),
  bid_on          DATE NOT NULL,
  job_name        TEXT NOT NULL CHECK (char_length(job_name) BETWEEN 1 AND 160),
  customer        TEXT CHECK (customer IS NULL OR char_length(customer) <= 160),
  item_key        TEXT NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 160),
  item_name       TEXT NOT NULL CHECK (char_length(item_name) BETWEEN 1 AND 200),
  unit            TEXT NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 10),
  qty             NUMERIC(16, 4) CHECK (qty IS NULL OR (qty >= 0 AND qty <= 1e12)),
  unit_price      NUMERIC(14, 4) NOT NULL CHECK (unit_price >= 0 AND unit_price <= 10000000),
  unit_cost       NUMERIC(14, 4) CHECK (unit_cost IS NULL OR (unit_cost >= 0 AND unit_cost <= 10000000)),
  result          TEXT NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'won', 'lost')),
  low_unit_price  NUMERIC(14, 4) CHECK (low_unit_price IS NULL OR (low_unit_price >= 0 AND low_unit_price <= 10000000)),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bid_items_key_idx ON public.bid_items (company_id, item_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bid_items_estimate_idx ON public.bid_items (estimate_id) WHERE deleted_at IS NULL;

-- The bid's outcome on the estimate itself: when it went out, and the low bid when we lost.
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS bid_on DATE;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS low_bid NUMERIC(14, 2) CHECK (low_bid IS NULL OR (low_bid >= 0 AND low_bid <= 1000000000));

ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "costs read" ON public.supplier_invoices;
CREATE POLICY "costs read" ON public.supplier_invoices
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "costs read" ON public.bid_items;
CREATE POLICY "costs read" ON public.bid_items
  FOR SELECT USING (company_id = current_company_id() AND deleted_at IS NULL AND ht_viewer_can_costs());

REVOKE ALL ON public.supplier_invoices, public.bid_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.supplier_invoices, public.bid_items FROM authenticated;
GRANT SELECT ON public.supplier_invoices TO authenticated;

-- Every column of bid_items but unit_cost (derived from the catalogue, so a
-- column added later is readable unless named here).
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.bid_items'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'unit_cost';
  REVOKE SELECT ON TABLE public.bid_items FROM authenticated;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.bid_items TO authenticated', v_cols);
END $$;

SELECT ht_prospect_lockdown('supplier_invoices', false);
SELECT ht_prospect_lockdown('bid_items', false);

-- Invoice PDFs and photos: private, read back by short signed links.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('invoices', 'invoices', false, 26214400, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
