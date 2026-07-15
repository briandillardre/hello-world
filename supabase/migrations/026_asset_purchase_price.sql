-- Purchase price — what the owner actually PAID for the asset (acquisition
-- cost / cost basis). Distinct from purchase_value, which is the current
-- replacement value. Both are useful: purchase_price for depreciation and
-- ROI, purchase_value for insurance / replacement planning.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS purchase_price NUMERIC;
