-- 161 — Safety review pass (Nov 9, the day's sec-check + ship-check on 159).
--
-- 1. A removed talk's signatures are no longer readable: the signatures'
--    read policy follows the talk's own deleted_at (159's read only the
--    company, so names and signature marks of a removed talk stayed readable
--    through the API).
-- 2. A report carries the phone's one-time key, unique per reporter, so a
--    double tap or a retry after a lost reply files ONE report and pages once
--    (159's check-then-insert let two concurrent filings both pass).

DROP POLICY IF EXISTS "members read" ON public.safety_signatures;
CREATE POLICY "members read" ON public.safety_signatures FOR SELECT USING (
  company_id = current_company_id()
  AND EXISTS (SELECT 1 FROM public.safety_talks t WHERE t.id = talk_id AND t.deleted_at IS NULL)
);

ALTER TABLE public.safety_reports ADD COLUMN IF NOT EXISTS idem TEXT
  CHECK (idem IS NULL OR idem ~ '^[A-Za-z0-9_-]{8,64}$');
CREATE UNIQUE INDEX IF NOT EXISTS safety_reports_idem_uq
  ON public.safety_reports (company_id, reported_by, idem) WHERE idem IS NOT NULL;
