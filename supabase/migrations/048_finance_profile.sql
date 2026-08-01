-- 048: company financial profile — feeds the admin Financials page
-- (revenue, margins, revenue/employee vs industry, 3-method valuation).
-- One JSONB blob, admin-edited; QBO auto-fill layers on later without a
-- schema change. Shape (all optional):
-- { "industry":"sitework", "lastYearRevenue":2400000, "ytdRevenue":1500000,
--   "lastYearProfit":190000, "ownerComp":120000, "employees":12,
--   "fleetValueOverride":650000, "otherAssets":50000, "liabilities":220000 }

ALTER TABLE companies ADD COLUMN IF NOT EXISTS finance_profile JSONB;
