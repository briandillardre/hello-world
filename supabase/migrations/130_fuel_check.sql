-- 130 — Fuel reconciliation pilot (lib/fuel-check.ts, /receipts/fuel,
-- docs/FUEL-RECONCILIATION.md).
--
-- From the market brief Brian forwarded (Oct 2026): Geotab and Samsara now
-- decline fuel-card purchases at the pump off their telematics. HammerTrack
-- issues no card and declines nothing — it reconciles, vendor-neutral, for a
-- contractor whose fuel goes on a mix of bank cards and fleet cards into a
-- mix of trucks and machines. The 90-day pilot for DCG: import the fuel
-- purchases, read each one against the truck's own evidence, raise only four
-- exceptions, classify every one valid or false for 30 days, and come out
-- with recoverable dollars, the false-positive rate, and the telemetry that
-- dependable detection still needs.
--
--   fuel_pilot          one row per company: when the pilot started, the
--                       default $/gal used ONLY to estimate gallons on a row
--                       without them, the approved-area radius, the runtime
--                       window.
--   fuel_card_assets    card → vehicle, WITH a start date. A card that moves
--                       from one truck to another on Oct 1 must not rewrite
--                       September's evidence when the nightly job re-checks
--                       it, so this is a history table and not a column on
--                       company_cards (that table is the receipt chase's
--                       card → PERSON map, and every member can write it).
--   fuel_transactions   one row per purchase, whichever door it came in by
--                       (a CSV export, a card-alert expense, typed by hand);
--                       `checks` holds the last run's four results.
--   fuel_exceptions     one row per (purchase, kind) that was ever raised.
--                       A re-check updates evidence in place; the verdict
--                       columns are written ONLY by the verdict action, so a
--                       re-check never wipes a classification. A kind that
--                       later passes gets cleared_at, never a delete.
--   fuel_merchant_places  the station geocode cache (service role only).
--
-- Reads: company members who may see dollars (ht_viewer_can_costs, the SQL
-- mirror of resolvePermissions' `costs` — the page is costs-gated, the
-- tables are too), following asset visibility (111). Writes: server actions
-- on the service client after the edit + costs checks — no write policies.
-- Prospects see none of it (119).
--
-- No backfill: new tables, three read functions, nothing scanned at deploy.

-- ── Dollars, in SQL ─────────────────────────────────────────────────────────
-- lib/permissions.ts resolvePermissions(), the `costs` ability only: the
-- Master always; a Prospective Client never; anyone else below Admin by
-- their per-person switch when set; then the company's view-levels table
-- (companies.role_policy) for their role; then the default (Admin, Manager).
CREATE OR REPLACE FUNCTION public.ht_viewer_can_costs() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.id = p.company_id THEN true
      WHEN r.role = 'prospect' THEN false
      WHEN r.role <> 'admin' AND p.can_view_costs IS NOT NULL THEN p.can_view_costs
      WHEN jsonb_typeof(c.role_policy -> r.role -> 'costs') = 'boolean' THEN (c.role_policy -> r.role ->> 'costs')::boolean
      ELSE r.role IN ('admin', 'manager')
    END
    FROM profiles p
    LEFT JOIN companies c ON c.id = p.company_id
    CROSS JOIN LATERAL (
      SELECT CASE WHEN p.role IN ('admin', 'manager', 'foreman', 'associate', 'prospect') THEN p.role ELSE 'associate' END AS role
    ) r
    WHERE p.id = auth.uid()), false)
$$;
REVOKE ALL ON FUNCTION public.ht_viewer_can_costs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ht_viewer_can_costs() TO authenticated, anon, service_role;

-- ── Pilot settings ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_pilot (
  company_id     UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  started_on     DATE,
  gas_price      NUMERIC(6,3) NOT NULL DEFAULT 3.100 CHECK (gas_price BETWEEN 0.5 AND 15),
  diesel_price   NUMERIC(6,3) NOT NULL DEFAULT 3.600 CHECK (diesel_price BETWEEN 0.5 AND 15),
  area_miles     NUMERIC(5,1) NOT NULL DEFAULT 5 CHECK (area_miles BETWEEN 0.5 AND 100),
  runtime_hours  INTEGER NOT NULL DEFAULT 24 CHECK (runtime_hours BETWEEN 4 AND 96),
  last_run_at    TIMESTAMPTZ,
  updated_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fuel_pilot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company fuel pilot read" ON public.fuel_pilot;
CREATE POLICY "company fuel pilot read" ON public.fuel_pilot
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs());
SELECT ht_prospect_lockdown('fuel_pilot', false);

-- ── Card → vehicle, with history ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_card_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  last4       TEXT NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  -- NULL = "no vehicle from this date" (the card came off the truck).
  asset_id    UUID REFERENCES assets(id) ON DELETE SET NULL,
  valid_from  DATE NOT NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, last4, valid_from)
);
ALTER TABLE public.fuel_card_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company fuel card assets read" ON public.fuel_card_assets;
CREATE POLICY "company fuel card assets read" ON public.fuel_card_assets
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "follows asset visibility" ON public.fuel_card_assets;
CREATE POLICY "follows asset visibility" ON public.fuel_card_assets AS RESTRICTIVE FOR ALL
  USING (asset_id IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id = fuel_card_assets.asset_id));
SELECT ht_prospect_lockdown('fuel_card_assets', false);

-- ── Purchases ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source             TEXT NOT NULL CHECK (source IN ('csv', 'expense', 'manual')),
  -- Re-importing an export never duplicates a purchase; the same purchase
  -- arriving by a second door (a card alert, then the statement) lands on
  -- the first row and its key is remembered in alt_keys.
  dedupe_key         TEXT NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  alt_keys           TEXT[] NOT NULL DEFAULT '{}',
  expense_id         UUID REFERENCES expenses(id) ON DELETE SET NULL,
  txn_at             TIMESTAMPTZ,
  txn_date           DATE NOT NULL,
  has_time           BOOLEAN NOT NULL DEFAULT false,
  merchant           TEXT NOT NULL CHECK (char_length(merchant) BETWEEN 1 AND 160),
  brand              TEXT,
  store_no           TEXT,
  address            TEXT,
  city               TEXT,
  state              TEXT,
  zip                TEXT,
  -- City words read off a bank line, longest first, until the geocoder picks one.
  city_candidates    TEXT[] NOT NULL DEFAULT '{}',
  -- The station, once placed: one point (exact), the brand's stations
  -- around the city (brand, up to 12 in merchant_points), or the city.
  lat                DOUBLE PRECISION,
  lng                DOUBLE PRECISION,
  merchant_points    JSONB,
  geocode_source     TEXT,
  geocode_precision  TEXT CHECK (geocode_precision IS NULL OR geocode_precision IN ('exact', 'brand', 'city')),
  place_label        TEXT,
  geocoded_at        TIMESTAMPTZ,
  gallons            NUMERIC(9,3) CHECK (gallons IS NULL OR (gallons > 0 AND gallons < 2000)),
  -- True when `gallons` was not in the export (estimated from $ at the
  -- pilot's default price — the check says "about").
  gallons_estimated  BOOLEAN NOT NULL DEFAULT false,
  unit_price         NUMERIC(7,3),
  amount             NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  product            TEXT CHECK (product IS NULL OR product IN ('diesel', 'gas', 'def', 'other')),
  card_last4         TEXT CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
  cardholder_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  driver_text        TEXT,
  vehicle_text       TEXT,
  job_text           TEXT,
  -- The vehicle or machine this purchase is checked against: set on the
  -- row itself (an export's vehicle column, a person's pick) or resolved
  -- from the card's assignment as of the purchase date.
  asset_id           UUID REFERENCES assets(id) ON DELETE SET NULL,
  asset_source       TEXT CHECK (asset_source IS NULL OR asset_source IN ('row', 'card')),
  -- The site the export coded it to (a job column matched to a zone).
  geofence_id        UUID REFERENCES geofences(id) ON DELETE SET NULL,
  odometer           NUMERIC(10,1),
  -- "Not a fuel purchase" (the store, not the pump) — out of every check and number.
  excluded           BOOLEAN NOT NULL DEFAULT false,
  excluded_reason    TEXT CHECK (excluded_reason IS NULL OR char_length(excluded_reason) <= 200),
  raw                JSONB NOT NULL DEFAULT '{}'::jsonb,
  checks             JSONB,
  checked_at         TIMESTAMPTZ,
  created_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fuel_transactions_raw_size CHECK (pg_column_size(raw) < 16000),
  CONSTRAINT fuel_transactions_checks_size CHECK (checks IS NULL OR pg_column_size(checks) < 24000),
  CONSTRAINT fuel_transactions_points_size CHECK (merchant_points IS NULL OR pg_column_size(merchant_points) < 4000)
);
CREATE UNIQUE INDEX IF NOT EXISTS fuel_transactions_dedupe_uidx ON public.fuel_transactions (company_id, dedupe_key);
CREATE UNIQUE INDEX IF NOT EXISTS fuel_transactions_expense_uidx ON public.fuel_transactions (expense_id) WHERE expense_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fuel_transactions_company_date_idx ON public.fuel_transactions (company_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS fuel_transactions_asset_idx ON public.fuel_transactions (asset_id) WHERE asset_id IS NOT NULL;
ALTER TABLE public.fuel_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company fuel transactions read" ON public.fuel_transactions;
CREATE POLICY "company fuel transactions read" ON public.fuel_transactions
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs());
DROP POLICY IF EXISTS "follows asset visibility" ON public.fuel_transactions;
CREATE POLICY "follows asset visibility" ON public.fuel_transactions AS RESTRICTIVE FOR ALL
  USING (asset_id IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id = fuel_transactions.asset_id));
SELECT ht_prospect_lockdown('fuel_transactions', false);

-- ── Exceptions and their verdicts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fuel_exceptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL REFERENCES public.fuel_transactions(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('asset_absent', 'gallons_exceed_tank', 'no_runtime_after', 'outside_shift_or_area')),
  severity         TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  -- { text: the plain-words sentence, facts: the numbers behind it }
  evidence         JSONB NOT NULL,
  dollars_at_risk  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (dollars_at_risk >= 0),
  -- What limited the check (lib/fuel-check.ts MissingCode).
  missing          TEXT[] NOT NULL DEFAULT '{}',
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A later check passed it (the fill showed up on the gauge). The row and
  -- its verdict stay; it leaves the queue.
  cleared_at       TIMESTAMPTZ,
  verdict          TEXT CHECK (verdict IS NULL OR verdict IN ('valid', 'false', 'unsure')),
  verdict_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verdict_at       TIMESTAMPTZ,
  verdict_note     TEXT CHECK (verdict_note IS NULL OR char_length(verdict_note) <= 500),
  CONSTRAINT fuel_exceptions_evidence_size CHECK (pg_column_size(evidence) < 8000),
  UNIQUE (transaction_id, kind)
);
CREATE INDEX IF NOT EXISTS fuel_exceptions_company_idx ON public.fuel_exceptions (company_id, computed_at DESC);
ALTER TABLE public.fuel_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company fuel exceptions read" ON public.fuel_exceptions;
CREATE POLICY "company fuel exceptions read" ON public.fuel_exceptions
  FOR SELECT USING (company_id = current_company_id() AND ht_viewer_can_costs());
-- An exception is as visible as its purchase (and so its vehicle, 111).
DROP POLICY IF EXISTS "follows its purchase" ON public.fuel_exceptions;
CREATE POLICY "follows its purchase" ON public.fuel_exceptions AS RESTRICTIVE FOR ALL
  USING (EXISTS (SELECT 1 FROM public.fuel_transactions t WHERE t.id = fuel_exceptions.transaction_id));
SELECT ht_prospect_lockdown('fuel_exceptions', false);

-- ── Station geocode cache ───────────────────────────────────────────────────
-- Per company (which stations a company buys at is its business). A provider
-- error is never cached; an honest "nothing found" is.
CREATE TABLE IF NOT EXISTS public.fuel_merchant_places (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key         TEXT NOT NULL CHECK (char_length(key) BETWEEN 1 AND 220),
  precision   TEXT CHECK (precision IS NULL OR precision IN ('exact', 'brand', 'city')),
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  points      JSONB,
  label       TEXT,
  radius_m    INTEGER,
  source      TEXT NOT NULL DEFAULT 'photon',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);
ALTER TABLE public.fuel_merchant_places ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fuel_merchant_places FROM PUBLIC, anon, authenticated;
SELECT ht_prospect_lockdown('fuel_merchant_places', false);

-- ── Evidence reads (service role; each bounded) ────────────────────────────
-- Where one asset sat still in a window (≤ 36 h): runs of stationary fixes
-- in one ~100 m cell, oldest first. lib/fuel-check.ts mergeStops joins runs
-- split by a cell edge. One range scan on (asset_id, timestamp).
CREATE OR REPLACE FUNCTION public.fuel_stops(p_company UUID, p_asset UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (lat DOUBLE PRECISION, lng DOUBLE PRECISION, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ, n INTEGER, engine_off BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH pts AS (
    SELECT l.lat AS y, l.lng AS x, l."timestamp" AS ts, COALESCE(l.speed, 0) <= 2 AS still, l.ignition AS ign,
           round(l.lat::numeric, 3) AS cy, round(l.lng::numeric, 3) AS cx
    FROM asset_locations l
    WHERE l.asset_id = p_asset AND l.company_id = p_company
      AND l."timestamp" >= p_from AND l."timestamp" < LEAST(p_to, p_from + interval '36 hours')
  ),
  marked AS (
    SELECT pts.*,
      CASE WHEN pts.still AND lag(pts.still) OVER w AND lag(pts.cy) OVER w = pts.cy AND lag(pts.cx) OVER w = pts.cx
           THEN 0 ELSE 1 END AS brk
    FROM pts WINDOW w AS (ORDER BY pts.ts)
  ),
  grouped AS (
    SELECT marked.*, sum(marked.brk) OVER (ORDER BY marked.ts ROWS UNBOUNDED PRECEDING) AS grp FROM marked
  )
  SELECT avg(g.y), avg(g.x), min(g.ts), max(g.ts), count(*)::int, COALESCE(bool_or(g.ign = false), false)
  FROM grouped g
  WHERE g.still
  GROUP BY g.grp
  ORDER BY min(g.ts)
  LIMIT 400
$$;

-- Which assets (one, or any in the company) were within p_radius_m of any of
-- up to 12 points in a window (≤ 36 h): per asset, first/last time, fixes,
-- stationary fixes, closest metres. The bounding box rides the geom GiST.
CREATE OR REPLACE FUNCTION public.fuel_near(
  p_company UUID, p_asset UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ,
  p_lat DOUBLE PRECISION[], p_lng DOUBLE PRECISION[], p_radius_m INTEGER
)
RETURNS TABLE (asset_id UUID, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ, n INTEGER, still_n INTEGER, min_m INTEGER)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH prm AS (
    SELECT LEAST(GREATEST(COALESCE(p_radius_m, 300), 10), 2000)::double precision AS r,
           LEAST(p_to, p_from + interval '36 hours') AS t_to
  ),
  pts AS (
    SELECT o.y, o.x FROM unnest(p_lat[1:12], p_lng[1:12]) AS o(y, x)
    WHERE o.y BETWEEN -85 AND 85 AND o.x BETWEEN -180 AND 180
  ),
  hits AS (
    SELECT l.asset_id AS aid, l."timestamp" AS ts, COALESCE(l.speed, 0) <= 2 AS still,
           ST_DistanceSphere(l.geom, ST_SetSRID(ST_MakePoint(pts.x, pts.y), 4326)) AS m, prm.r
    FROM prm CROSS JOIN pts
    JOIN LATERAL (
      SELECT l2.asset_id, l2."timestamp", l2.speed, l2.geom
      FROM asset_locations l2
      WHERE l2.company_id = p_company
        AND (p_asset IS NULL OR l2.asset_id = p_asset)
        AND l2."timestamp" >= p_from AND l2."timestamp" < prm.t_to
        AND l2.geom && ST_MakeEnvelope(
              pts.x - prm.r / (111320.0 * cos(radians(pts.y))), pts.y - prm.r / 110000.0,
              pts.x + prm.r / (111320.0 * cos(radians(pts.y))), pts.y + prm.r / 110000.0, 4326)
    ) l ON true
  )
  SELECT h.aid, min(h.ts), max(h.ts), count(*)::int, (count(*) FILTER (WHERE h.still))::int, min(h.m)::int
  FROM hits h
  WHERE h.m <= h.r
  GROUP BY h.aid
  ORDER BY min(h.ts)
  LIMIT 50
$$;

-- One asset's fuel gauge in a window (≤ 48 h): only the fixes that carry a
-- level, under any key the catalog knows it by (lib/telemetry-catalog.ts).
CREATE OR REPLACE FUNCTION public.fuel_gauge(p_company UUID, p_asset UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (ts TIMESTAMPTZ, speed REAL, pct DOUBLE PRECISION)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT x.ts, x.sp, x.lvl FROM (
    SELECT l."timestamp" AS ts, l.speed AS sp,
      COALESCE(
        CASE WHEN (l.raw ->> 'can.fuel.level') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (l.raw ->> 'can.fuel.level')::double precision END,
        CASE WHEN (l.raw ->> 'fuel.level') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (l.raw ->> 'fuel.level')::double precision END,
        CASE WHEN (l.raw ->> 'obd.fuel.level') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (l.raw ->> 'obd.fuel.level')::double precision END,
        CASE WHEN (l.raw ->> 'can.fuel.level.percent') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (l.raw ->> 'can.fuel.level.percent')::double precision END
      ) AS lvl
    FROM asset_locations l
    WHERE l.asset_id = p_asset AND l.company_id = p_company
      AND l."timestamp" >= p_from AND l."timestamp" < LEAST(p_to, p_from + interval '48 hours')
  ) x
  WHERE x.lvl IS NOT NULL
  ORDER BY x.ts
  LIMIT 20000
$$;

REVOKE ALL ON FUNCTION public.fuel_stops(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fuel_near(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, DOUBLE PRECISION[], DOUBLE PRECISION[], INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fuel_gauge(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_stops(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.fuel_near(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, DOUBLE PRECISION[], DOUBLE PRECISION[], INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fuel_gauge(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
