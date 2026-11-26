-- 167 — books closed by the 10th (the 90-day test, Nov 26): a nightly read of
-- the company's QuickBooks and a month-end close checklist the owner signs.
--
--  books_snapshots — one row per pull from QuickBooks: the chart of accounts
--    (name, type, balance), AR / AP aging (bucket totals + the top names),
--    12 months of P&L and the last 60 days of deposits, bounded and stored as
--    one jsonb. A failed pull stores its error instead. The cron keeps the
--    newest 60 per company. The pull also keeps the QuickBooks connection
--    alive (Intuit's refresh token lapses ~100 days after its last use).
--
--  books_closes — one row per company + month (the first of the month): the
--    steps ticked (`{stepKey: {by, name, at, note}}`) and who signed it off,
--    as what (owner / bookkeeper / CPA), when.
--
-- Both are the owner's books: reads need costs AND Admin or the Master
-- (ht_viewer_rank() >= 3). Members SELECT only (writes on the service role
-- after the session checks), anon nothing, prospects nothing. Idempotent.

CREATE TABLE IF NOT EXISTS public.books_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  taken_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT NOT NULL DEFAULT 'qbo' CHECK (source IN ('qbo')),
  data        JSONB CHECK (data IS NULL OR (jsonb_typeof(data) = 'object' AND pg_column_size(data) < 400000)),
  error       TEXT CHECK (error IS NULL OR char_length(error) <= 500),
  CHECK (data IS NOT NULL OR error IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS books_snapshots_company_idx ON public.books_snapshots (company_id, taken_at DESC);

CREATE TABLE IF NOT EXISTS public.books_closes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month        DATE NOT NULL CHECK (extract(day FROM month) = 1),
  items        JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(items) = 'object' AND pg_column_size(items) < 40000),
  signed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_name  TEXT CHECK (signed_name IS NULL OR char_length(signed_name) BETWEEN 1 AND 120),
  signed_role  TEXT CHECK (signed_role IS NULL OR signed_role IN ('owner', 'bookkeeper', 'cpa')),
  signed_at    TIMESTAMPTZ,
  note         TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, month),
  CHECK ((signed_at IS NULL) = (signed_role IS NULL))
);

ALTER TABLE public.books_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books_closes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner books read" ON public.books_snapshots;
CREATE POLICY "owner books read" ON public.books_snapshots
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs() AND ht_viewer_rank() >= 3);
DROP POLICY IF EXISTS "owner books read" ON public.books_closes;
CREATE POLICY "owner books read" ON public.books_closes
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs() AND ht_viewer_rank() >= 3);

REVOKE ALL ON public.books_snapshots, public.books_closes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.books_snapshots, public.books_closes FROM authenticated;
GRANT SELECT ON public.books_snapshots, public.books_closes TO authenticated;

SELECT ht_prospect_lockdown('books_snapshots', false);
SELECT ht_prospect_lockdown('books_closes', false);

NOTIFY pgrst, 'reload schema';
