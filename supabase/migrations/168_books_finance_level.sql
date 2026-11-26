-- 168 — the books tables follow the Financials view level (sec-check on 167,
-- Nov 26). 167 read books_snapshots / books_closes on company + costs +
-- Admin rank; if the Master turned Financials off for Admins in the
-- view-levels table, the pages hid but an Admin's session could still read
-- bank balances, P&L and aging through PostgREST. ht_viewer_can_finance()
-- is the SQL mirror of resolvePermissions' `finance` for the ranks these
-- policies admit (the Master always; a prospect never; otherwise the
-- company's role_policy row for the role, else the default — on for Admin).
-- 167 is frozen and untouched. Idempotent.

CREATE OR REPLACE FUNCTION public.ht_viewer_can_finance() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.id = p.company_id THEN true
      WHEN p.role = 'prospect' THEN false
      WHEN jsonb_typeof(c.role_policy -> p.role -> 'finance') = 'boolean' THEN (c.role_policy -> p.role ->> 'finance')::boolean
      ELSE p.role = 'admin'
    END
    FROM profiles p
    LEFT JOIN companies c ON c.id = p.company_id
    WHERE p.id = auth.uid()), false)
$$;
REVOKE ALL ON FUNCTION public.ht_viewer_can_finance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ht_viewer_can_finance() TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "owner books read" ON public.books_snapshots;
CREATE POLICY "owner books read" ON public.books_snapshots
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs() AND ht_viewer_rank() >= 3 AND ht_viewer_can_finance());
DROP POLICY IF EXISTS "owner books read" ON public.books_closes;
CREATE POLICY "owner books read" ON public.books_closes
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs() AND ht_viewer_rank() >= 3 AND ht_viewer_can_finance());

NOTIFY pgrst, 'reload schema';
