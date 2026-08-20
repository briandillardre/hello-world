-- App-review demo account — run MANUALLY in the SQL Editor (not a migration).
--
-- Apple/Google reviewers need a login with data they can poke. This builds a
-- self-contained company ("Blue Ridge Sitework Co.") with assets, a zone, and
-- a week of location history around Greenville — no DCG data exposed.
--
-- STEP 1 (dashboard, once): Authentication → Users → Add user
--   email:    review@hammertrack.ai
--   password: (pick one, store in password manager, paste into the App Review
--              notes on submission day)
--   ✓ auto-confirm
-- STEP 2: run this whole script.
-- (Fixed Aug 20: real column names/roles + api_key — the Aug 9 draft never ran.)

DO $$
DECLARE
  v_user UUID;
  v_company UUID;
  v_truck UUID; v_excav UUID; v_tool UUID;
  v_zone UUID;
  t TIMESTAMPTZ;
BEGIN
  SELECT id INTO v_user FROM auth.users WHERE email = 'review@hammertrack.ai';
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Create the review@hammertrack.ai auth user first (Auth -> Users -> Add user)';
  END IF;

  -- Idempotent: wipe a previous seed for this user.
  SELECT company_id INTO v_company FROM profiles WHERE id = v_user;
  IF v_company IS NOT NULL THEN
    DELETE FROM companies WHERE id = v_company; -- cascades
  END IF;

  INSERT INTO companies (name, plan, api_key)
  VALUES ('Blue Ridge Sitework Co.', 'founding25', 'ht_review_' || encode(gen_random_bytes(16), 'hex'))
  RETURNING id INTO v_company;

  INSERT INTO profiles (id, company_id, name, role)
  VALUES (v_user, v_company, 'App Reviewer', 'admin')
  ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, name = EXCLUDED.name, role = EXCLUDED.role;

  INSERT INTO assets (company_id, name, type, status, tracker_id, hourly_rate, daily_cost)
  VALUES (v_company, 'F-350 Crew Truck', 'vehicle', 'active', 'review-truck-1', 85, 40)
  RETURNING id INTO v_truck;
  INSERT INTO assets (company_id, name, type, status, tracker_id, hourly_rate, daily_cost)
  VALUES (v_company, 'CAT 305 Excavator', 'equipment', 'active', 'review-excav-1', 95, 60)
  RETURNING id INTO v_excav;
  INSERT INTO assets (company_id, name, type, status, tracker_id)
  VALUES (v_company, 'Topcon Laser Level', 'tool', 'active', 'review-tool-1')
  RETURNING id INTO v_tool;

  -- Job-site zone near downtown Greenville.
  INSERT INTO geofences (company_id, name, color, kind, geometry)
  VALUES (v_company, 'Riverside Office Park', '#ff9e16', 'site',
    ST_GeomFromText('POLYGON((-82.408 34.847, -82.400 34.847, -82.400 34.852, -82.408 34.852, -82.408 34.847))', 4326))
  RETURNING id INTO v_zone;

  -- 7 workdays of pings: truck + excavator on site 7am-3pm, parked overnight.
  FOR d IN 1..7 LOOP
    t := date_trunc('day', now()) - (d || ' days')::interval + interval '7 hours';
    WHILE t < date_trunc('day', now()) - (d || ' days')::interval + interval '15 hours' LOOP
      INSERT INTO asset_locations (company_id, asset_id, lat, lng, speed, "timestamp") VALUES
        (v_company, v_truck, 34.8495 + (random() - 0.5) * 0.003, -82.404 + (random() - 0.5) * 0.006, CASE WHEN random() < 0.3 THEN 15 + random() * 30 ELSE 0 END, t),
        (v_company, v_excav, 34.8500 + (random() - 0.5) * 0.002, -82.403 + (random() - 0.5) * 0.004, CASE WHEN random() < 0.5 THEN 3 + random() * 5 ELSE 0 END, t);
      t := t + interval '5 minutes';
    END LOOP;
  END LOOP;

  -- Tool rides the truck (presence hours flow from the pairing log).
  INSERT INTO pairing_log (company_id, kind, member_asset_id, carrier_asset_id, started_at, last_seen)
  VALUES (v_company, 'tool', v_tool, v_truck, now() - interval '7 days', now());
  INSERT INTO tool_associations (company_id, tool_asset_id, gateway_asset_id, rssi, last_seen)
  VALUES (v_company, v_tool, v_truck, -60, now())
  ON CONFLICT (tool_asset_id) DO UPDATE SET gateway_asset_id = EXCLUDED.gateway_asset_id, last_seen = EXCLUDED.last_seen;

  -- Bank the exact-hours ledger for the seeded week.
  PERFORM rebuild_zone_usage(v_zone, now() - interval '8 days', now());

  RAISE NOTICE 'Review company seeded: %', v_company;
END $$;
