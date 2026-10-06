/**
 * Migration 130 (the fuel pilot), applied for real before it ships: PGlite
 * (Postgres 17 compiled to WASM, in-process — no server, no root) runs the
 * migration VERBATIM over stubbed Supabase pieces (auth.uid, profiles, the
 * 119 lockdown function as shipped, 111's asset ladder) and a stubbed PostGIS
 * (a geometry is a box; && and ST_DistanceSphere do what they do), twice —
 * a failing migration fails every deploy, and a re-run must be harmless.
 * Then it checks the RLS a session gets (the costs ability, asset
 * visibility, prospects, no writes) and runs the three evidence functions on
 * synthetic fixes.
 *
 * PGlite is not a dependency of this repo. Install it anywhere else and point
 * at it:
 *   (cd /some/scratch && npm i @electric-sql/pglite@0.3)
 *   PGLITE_DIR=/some/scratch node scripts/fuel-sql-test.mjs
 * Run it after ANY change to a fuel_* function or policy (in a NEW migration
 * once 130 has shipped — a pushed migration is frozen).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.env.PGLITE_DIR) {
  console.error('Set PGLITE_DIR to a folder where `npm i @electric-sql/pglite@0.3` ran (outside this repo).')
  process.exit(2)
}
const { PGlite } = await import(pathToFileURL(join(process.env.PGLITE_DIR, 'node_modules/@electric-sql/pglite/dist/index.js')).href)
const MIGRATION = new URL('../supabase/migrations/130_fuel_check.sql', import.meta.url)
const L119 = new URL('../supabase/migrations/119_prospect_lockdown_and_api_key.sql', import.meta.url)
const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.error('  ✗ ' + name + (extra !== '' ? ' — ' + JSON.stringify(extra) : '')) }

// The lockdown function exactly as 119 ships it.
const m119 = readFileSync(L119, 'utf8')
const lockdown = m119.slice(m119.indexOf('CREATE OR REPLACE FUNCTION ht_prospect_lockdown'), m119.indexOf('REVOKE ALL ON FUNCTION ht_prospect_lockdown'))

await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
  CREATE TABLE companies (id uuid PRIMARY KEY, name text, role_policy jsonb);
  CREATE TABLE profiles (id uuid PRIMARY KEY, company_id uuid, role text, can_view_costs boolean);
  CREATE FUNCTION current_company_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT company_id FROM profiles WHERE id = auth.uid() $$;
  CREATE FUNCTION ht_viewer_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM profiles WHERE id = auth.uid() $$;
  ${lockdown}
  CREATE TABLE assets (id uuid PRIMARY KEY, company_id uuid NOT NULL, name text, type text, metadata jsonb DEFAULT '{}'::jsonb, tracker_id text, active boolean DEFAULT true);
  CREATE TABLE expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid);
  CREATE TABLE geofences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid);
  -- 111's ladder on assets, verbatim in substance.
  CREATE FUNCTION ht_viewer_rank() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT COALESCE((SELECT CASE WHEN p.id = p.company_id THEN 4 WHEN p.role='admin' THEN 3 WHEN p.role='manager' THEN 2 WHEN p.role='foreman' THEN 1 ELSE 0 END FROM profiles p WHERE p.id = auth.uid()), -1) $$;
  CREATE FUNCTION ht_visibility_rank(meta jsonb) RETURNS int LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE meta->>'visibility' WHEN 'master' THEN 4 WHEN 'admins' THEN 3 WHEN 'managers' THEN 2 ELSE 0 END $$;
  ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "company assets" ON assets FOR ALL USING (company_id = current_company_id());
  CREATE POLICY "asset visibility ladder" ON assets AS RESTRICTIVE FOR ALL USING (ht_visibility_rank(metadata) <= ht_viewer_rank());
  -- PostGIS, stubbed: a geometry is a box (a point is a degenerate one).
  CREATE TYPE geometry AS (x1 float8, y1 float8, x2 float8, y2 float8);
  CREATE FUNCTION ST_MakePoint(x float8, y float8) RETURNS geometry LANGUAGE sql IMMUTABLE AS $$ SELECT ROW(x, y, x, y)::geometry $$;
  CREATE FUNCTION ST_SetSRID(g geometry, s int) RETURNS geometry LANGUAGE sql IMMUTABLE AS $$ SELECT g $$;
  CREATE FUNCTION ST_MakeEnvelope(a float8, b float8, c float8, d float8, s int) RETURNS geometry LANGUAGE sql IMMUTABLE AS $$ SELECT ROW(a, b, c, d)::geometry $$;
  CREATE FUNCTION geom_overlap(a geometry, b geometry) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT (a).x1 <= (b).x2 AND (a).x2 >= (b).x1 AND (a).y1 <= (b).y2 AND (a).y2 >= (b).y1 $$;
  CREATE OPERATOR && (LEFTARG = geometry, RIGHTARG = geometry, FUNCTION = geom_overlap);
  CREATE FUNCTION ST_DistanceSphere(a geometry, b geometry) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
    SELECT 6371008.8 * 2 * asin(sqrt(power(sin(radians(((b).y1 - (a).y1) / 2)), 2) + cos(radians((a).y1)) * cos(radians((b).y1)) * power(sin(radians(((b).x1 - (a).x1) / 2)), 2))) $$;
  CREATE TABLE asset_locations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), asset_id uuid REFERENCES assets(id), company_id uuid,
    lat float8, lng float8, geom geometry, speed real, ignition boolean, "timestamp" timestamptz, raw jsonb);
`)

const sql = readFileSync(MIGRATION, 'utf8')
try { await db.exec(sql); ok('migration applies', true) } catch (e) { ok('migration applies', false, e.message) }
try { await db.exec(sql); ok('migration re-applies (idempotent)', true) } catch (e) { ok('migration re-applies (idempotent)', false, e.message) }

// ── Data ────────────────────────────────────────────────────────────────────
const C1 = '11111111-1111-1111-1111-111111111111'
const C2 = '22222222-2222-2222-2222-222222222222'
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const people = [
  [C1, C1, 'admin', null],          // the Master
  [U(2), C1, 'manager', null],
  [U(3), C1, 'foreman', null],
  [U(4), C1, 'foreman', true],      // a foreman given $ by a switch
  [U(5), C1, 'prospect', null],
  [U(6), C1, 'viewer', null],       // retired role = associate
  [U(7), C1, 'admin', false],       // an admin's per-person switch is ignored
  [U(8), C2, 'manager', null],      // another company
]
await db.query(`INSERT INTO companies (id, name) VALUES ($1, 'DCG'), ($2, 'Other')`, [C1, C2])
for (const [id, co, role, costs] of people) {
  await db.query(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING`, [id])
  await db.query(`INSERT INTO profiles (id, company_id, role, can_view_costs) VALUES ($1, $2, $3, $4)`, [id, co, role, costs])
}
const A = U(100), B = U(101), Cx = U(102)
await db.query(`INSERT INTO assets (id, company_id, name, type, metadata) VALUES
  ($1, $4, 'RAM 3500', 'vehicle', '{}'), ($2, $4, 'Owner truck', 'vehicle', '{"visibility":"master"}'), ($3, $4, 'F750', 'vehicle', '{}')`, [A, B, Cx, C1])
const tx = async (id, asset) => db.query(`INSERT INTO fuel_transactions (id, company_id, source, dedupe_key, txn_date, merchant, amount, asset_id)
  VALUES ($1, $2, 'csv', $3, '2026-10-01', 'SPINX #0156', 84.20, $4)`, [id, C1, 'k' + id, asset])
const T1 = U(201), T2 = U(202), T3 = U(203)
await tx(T1, A); await tx(T2, B); await tx(T3, null)
for (const t of [T1, T2, T3]) {
  await db.query(`INSERT INTO fuel_exceptions (transaction_id, company_id, kind, severity, evidence, dollars_at_risk)
    VALUES ($1, $2, 'asset_absent', 'high', '{"text":"x"}', 84.2)`, [t, C1])
}

// ── RLS ─────────────────────────────────────────────────────────────────────
await db.exec(`GRANT USAGE ON SCHEMA public, auth TO authenticated; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;`)
async function as(uid, q, params = []) {
  await db.exec(`RESET ROLE`)
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid])
  await db.exec(`SET ROLE authenticated`)
  try { return (await db.query(q, params)).rows } finally { await db.exec(`RESET ROLE`) }
}
const canCosts = async (uid) => (await as(uid, `SELECT ht_viewer_can_costs() AS c`))[0].c
ok('costs: the Master', await canCosts(C1) === true)
ok('costs: a Manager by default', await canCosts(U(2)) === true)
ok('costs: a Foreman by default — no', await canCosts(U(3)) === false)
ok('costs: a Foreman with the $ switch on', await canCosts(U(4)) === true)
ok('costs: a Prospective Client — never', await canCosts(U(5)) === false)
ok('costs: the retired viewer role reads as Associate — no', await canCosts(U(6)) === false)
ok('costs: an Admin\'s per-person switch is ignored (the table decides)', await canCosts(U(7)) === true)
await db.query(`UPDATE companies SET role_policy = '{"manager":{"costs":false},"admin":{"costs":false}}' WHERE id = $1`, [C1])
ok('costs: the view-levels table turns Managers off', await canCosts(U(2)) === false)
ok('costs: …and Admins', await canCosts(U(7)) === false)
ok('costs: never the Master', await canCosts(C1) === true)
await db.query(`UPDATE companies SET role_policy = NULL WHERE id = $1`, [C1])
ok('costs: signed out — no', await canCosts('') === false)

const seen = async (uid) => (await as(uid, `SELECT id FROM fuel_transactions ORDER BY id`)).map((r) => r.id)
ok('read: the Master sees every purchase', (await seen(C1)).length === 3)
ok('read: a Manager does not see the purchase on the owner-only truck', JSON.stringify(await seen(U(2))) === JSON.stringify([T1, T3]), await seen(U(2)))
ok('read: a Foreman without $ sees nothing', (await seen(U(3))).length === 0)
ok('read: a Prospective Client sees nothing', (await seen(U(5))).length === 0)
ok('read: another company sees nothing', (await seen(U(8))).length === 0)
const exSeen = async (uid) => (await as(uid, `SELECT transaction_id FROM fuel_exceptions ORDER BY transaction_id`)).map((r) => r.transaction_id)
ok('read: exceptions follow their purchase (owner-only truck hidden)', JSON.stringify(await exSeen(U(2))) === JSON.stringify([T1, T3]), await exSeen(U(2)))
let wrote = true
try { await as(U(2), `UPDATE fuel_exceptions SET verdict = 'false'`) } catch { wrote = false }
const after = (await db.query(`SELECT count(*)::int AS n FROM fuel_exceptions WHERE verdict IS NOT NULL`)).rows[0].n
ok('write: a session cannot set a verdict through the API (no write policy)', after === 0, { wrote, after })
let inserted = true
try { await as(C1, `INSERT INTO fuel_transactions (company_id, source, dedupe_key, txn_date, merchant, amount) VALUES ('${C1}', 'csv', 'zz', '2026-10-01', 'X', 1)`) } catch { inserted = false }
ok('write: even the Master cannot insert through the API', !inserted)
await db.query(`INSERT INTO fuel_merchant_places (company_id, key, precision, lat, lng) VALUES ($1, 'spinx|greenville|sc|', 'exact', 34.85, -82.39)`, [C1])
let cacheRows = 0
try { cacheRows = (await as(C1, `SELECT * FROM fuel_merchant_places`)).length } catch { cacheRows = 0 }
ok('cache: the geocode cache is service-role only (RLS, no policies)', cacheRows === 0, cacheRows)
let rpc = true
try { await as(C1, `SELECT * FROM fuel_gauge('${C1}', '${A}', now() - interval '1 day', now())`) } catch { rpc = false }
ok('functions: a session cannot call the evidence reads', !rpc)

// ── Constraints ─────────────────────────────────────────────────────────────
const bad = async (q) => { try { await db.query(q); return false } catch { return true } }
ok('constraint: duplicate dedupe key refused', await bad(`INSERT INTO fuel_transactions (company_id, source, dedupe_key, txn_date, merchant, amount) VALUES ('${C1}', 'csv', 'k${T1}', '2026-10-01', 'X', 1)`))
ok('constraint: one row per (purchase, kind)', await bad(`INSERT INTO fuel_exceptions (transaction_id, company_id, kind, severity, evidence) VALUES ('${T1}', '${C1}', 'asset_absent', 'low', '{}')`))
ok('constraint: unknown kind refused', await bad(`INSERT INTO fuel_exceptions (transaction_id, company_id, kind, severity, evidence) VALUES ('${T1}', '${C1}', 'vibes', 'low', '{}')`))
ok('constraint: a card is four digits', await bad(`INSERT INTO fuel_card_assets (company_id, last4, valid_from) VALUES ('${C1}', '48a1', '2026-10-01')`))
ok('constraint: zero dollars refused', await bad(`INSERT INTO fuel_transactions (company_id, source, dedupe_key, txn_date, merchant, amount) VALUES ('${C1}', 'csv', 'q1', '2026-10-01', 'X', 0)`))
// An upsert with the check engine's columns leaves the verdict alone.
await db.query(`UPDATE fuel_exceptions SET verdict = 'valid', verdict_note = 'confirmed' WHERE transaction_id = $1`, [T1])
await db.query(`INSERT INTO fuel_exceptions (transaction_id, company_id, kind, severity, evidence, dollars_at_risk, missing, computed_at, cleared_at)
  VALUES ($1, $2, 'asset_absent', 'medium', '{"text":"new"}', 50, '{no_time}', now(), NULL)
  ON CONFLICT (transaction_id, kind) DO UPDATE SET severity = EXCLUDED.severity, evidence = EXCLUDED.evidence, dollars_at_risk = EXCLUDED.dollars_at_risk,
    missing = EXCLUDED.missing, computed_at = EXCLUDED.computed_at, cleared_at = EXCLUDED.cleared_at`, [T1, C1])
const kept = (await db.query(`SELECT verdict, verdict_note, evidence->>'text' AS t, severity FROM fuel_exceptions WHERE transaction_id = $1`, [T1])).rows[0]
ok('upsert: evidence replaced, verdict kept', kept.verdict === 'valid' && kept.verdict_note === 'confirmed' && kept.t === 'new' && kept.severity === 'medium', kept)

// ── The evidence functions ──────────────────────────────────────────────────
const P = { lat: 34.8526, lng: -82.394 }
const t0 = Date.parse('2026-10-01T11:00:00Z')
const fixes = []
const add = (asset, ms, lat, lng, speed, ign, raw = {}) => fixes.push([asset, ms, lat, lng, speed, ign, raw])
// Truck A: drives in, 10 minutes at the pump (engine off once), drives off, then a long stop 2 km away.
for (let i = 0; i < 20; i++) add(A, t0 + i * 15_000, P.lat - 0.01 + i * 0.0005, P.lng, 35, true, { 'can.fuel.level': 13 })
for (let i = 0; i < 10; i++) add(A, t0 + 300_000 + i * 60_000, P.lat + 0.00005 * (i % 2), P.lng + 0.00004, 0, i !== 3, i < 5 ? { 'can.fuel.level': 20 + i * 10 } : {})
for (let i = 0; i < 20; i++) add(A, t0 + 900_000 + i * 15_000, P.lat + 0.001 + i * 0.0005, P.lng, 40, true, { 'can.fuel.level': '71' })
for (let i = 0; i < 6; i++) add(A, t0 + 1_500_000 + i * 120_000, P.lat + 0.02, P.lng + 0.001, 0, false)
// F750 sat at the pump at the same time; the owner-only truck far away.
for (let i = 0; i < 5; i++) add(Cx, t0 + 400_000 + i * 60_000, P.lat + 0.0003, P.lng - 0.0002, 0, false)
for (let i = 0; i < 5; i++) add(B, t0 + 400_000 + i * 60_000, P.lat + 0.2, P.lng, 0, false)
for (const [asset, ms, lat, lng, speed, ign, raw] of fixes) {
  await db.query(`INSERT INTO asset_locations (asset_id, company_id, lat, lng, geom, speed, ignition, "timestamp", raw)
    VALUES ($1, $2, $3, $4, ST_MakePoint($4, $3), $5, $6, to_timestamp($7 / 1000.0), $8)`, [asset, C1, lat, lng, speed, ign, ms, JSON.stringify(raw)])
}
const from = new Date(t0 - 3_600_000).toISOString(), to = new Date(t0 + 3 * 3_600_000).toISOString()
const stops = (await db.query(`SELECT * FROM fuel_stops($1, $2, $3, $4)`, [C1, A, from, to])).rows
ok('stops: the pump stop and the long stop', stops.length === 2, stops)
ok('stops: the pump stop knows the engine went off and spans 9 minutes', stops[0]?.engine_off === true && (new Date(stops[0].last_at) - new Date(stops[0].first_at)) === 540_000 && stops[0].n === 10, stops[0])
ok('stops: a moving fix never joins a stop', stops.every((s) => s.n === 10 || s.n === 6))
const nearA = (await db.query(`SELECT * FROM fuel_near($1, $2, $3, $4, $5, $6, 250)`, [C1, A, from, to, [P.lat], [P.lng]])).rows
ok('near: the truck at the pump, its stationary fixes counted', nearA.length === 1 && nearA[0].asset_id === A && nearA[0].still_n === 10 && nearA[0].min_m < 15, nearA)
const nearAny = (await db.query(`SELECT * FROM fuel_near($1, NULL, $2, $3, $4, $5, 250)`, [C1, from, to, [P.lat, 0], [P.lng, 0]])).rows
ok('near: any asset — the RAM and the F750, not the far truck', nearAny.map((r) => r.asset_id).sort().join() === [A, Cx].sort().join(), nearAny)
const nearOther = (await db.query(`SELECT * FROM fuel_near($1, NULL, $2, $3, $4, $5, 250)`, [C2, from, to, [P.lat], [P.lng]])).rows
ok('near: another company\'s id finds nothing', nearOther.length === 0)
const nearHuge = (await db.query(`SELECT * FROM fuel_near($1, $2, $3, $4, $5, $6, 999999)`, [C1, B, from, to, [P.lat], [P.lng]])).rows
ok('near: the radius is capped at 2 km (the far truck is 22 km off)', nearHuge.length === 0)
const gauge = (await db.query(`SELECT * FROM fuel_gauge($1, $2, $3, $4)`, [C1, A, from, to])).rows
ok('gauge: only fixes with a level, numbers and numeric strings both', gauge.length === 45 && gauge.every((g) => typeof g.pct === 'number'), gauge.length)
ok('gauge: oldest first, the climb at the pump visible', gauge[0].pct === 13 && gauge[gauge.length - 1].pct === 71 && gauge.some((g) => g.pct === 60))
const capped = (await db.query(`SELECT count(*)::int AS n FROM fuel_stops($1, $2, $3, $4)`, [C1, A, new Date(t0 - 10 * 86_400_000).toISOString(), to])).rows[0].n
ok('stops: a window longer than 36 h is cut to 36 h from its start', capped === 0)
// A date-only purchase reads the gauge over 54 h (6 before the day, the day, 24 after).
for (const h of [50, 65]) {
  await db.query(`INSERT INTO asset_locations (asset_id, company_id, lat, lng, geom, speed, ignition, "timestamp", raw)
    VALUES ($1, $2, $3, $4, ST_MakePoint($4, $3), 40, true, to_timestamp($5 / 1000.0), '{"can.fuel.level": 44}')`, [A, C1, P.lat, P.lng, t0 + h * 3_600_000])
}
const longGauge = (await db.query(`SELECT * FROM fuel_gauge($1, $2, $3, $4)`, [C1, A, new Date(t0 - 3_600_000).toISOString(), new Date(t0 + 70 * 3_600_000).toISOString()])).rows
ok('gauge: a 54-hour date-only window is read whole; past 60 h it is cut', longGauge.some((g) => new Date(g.ts).getTime() === t0 + 50 * 3_600_000) && !longGauge.some((g) => new Date(g.ts).getTime() === t0 + 65 * 3_600_000))

console.log(`migration 130 (PGlite): ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
