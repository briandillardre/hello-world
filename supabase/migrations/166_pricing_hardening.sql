-- 166 — pricing v0 hardening (the review pass on 165, Nov 25).
--
--  1. Margins stay an Admin's. A bid line frozen from an estimate carries the
--     estimate's markups in its unit price; any costs login can see the
--     direct cost, so dividing one by the other gave a Manager the margin
--     that 147 keeps Admin-only (estimate_markups: ht_viewer_rank() >= 3).
--     Estimate-frozen rows now read like the markups (rank >= 3); rows pasted
--     from old bid sheets (source = 'import') stay readable by costs logins.
--
--  2. invoice_reads — one row per invoice the AI reader was asked to read, so
--     the per-company daily cap (200) holds across server instances (the
--     in-memory limiter forgot it on every cold start). Service role only:
--     RLS on, no policies, no grants.
--
-- Idempotent; 165 is frozen and untouched.

DROP POLICY IF EXISTS "costs read" ON public.bid_items;
CREATE POLICY "costs read" ON public.bid_items
  FOR SELECT USING (
    company_id = current_company_id()
    AND deleted_at IS NULL
    AND ht_viewer_can_costs()
    AND (source = 'import' OR ht_viewer_rank() >= 3)
  );

CREATE TABLE IF NOT EXISTS public.invoice_reads (
  id          BIGSERIAL PRIMARY KEY,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_reads_company_at_idx ON public.invoice_reads (company_id, at DESC);

ALTER TABLE public.invoice_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_reads FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.invoice_reads_id_seq FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
