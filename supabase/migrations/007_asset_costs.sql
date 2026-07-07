-- Per-asset cost structure — the inputs for real job-cost math.
-- All optional; which ones apply varies by asset type (see AssetForm):
--   vehicle:   hourly_rate ($/operating-hr), mileage_rate ($/mi), daily_cost, purchase_value
--   equipment: hourly_rate ($/engine-hr), daily_cost, purchase_value
--   personnel: hourly_rate (loaded labor $/hr)
--   tool:      purchase_value (replacement $)
--
-- daily_cost = ownership that accrues whether or not the asset moves
-- (payment, insurance, depreciation). hourly/mileage accrue from observed
-- activity in asset_locations. The map's cost chip sums these over the
-- selected window — no more demo PROJECT rates on real accounts.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS hourly_rate    NUMERIC CHECK (hourly_rate    >= 0);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS mileage_rate   NUMERIC CHECK (mileage_rate   >= 0);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS daily_cost     NUMERIC CHECK (daily_cost     >= 0);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS purchase_value NUMERIC CHECK (purchase_value >= 0);
