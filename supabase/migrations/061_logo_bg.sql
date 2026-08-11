-- 061: optional backing color behind the company logo. Logos render exactly
-- as uploaded since Aug 7 (no forced white chip) — but a dark mark vanishes
-- on the navy sidebar. The admin now picks a backing on Settings → Company:
-- NULL = none (as uploaded), else a #rrggbb fill drawn behind the logo in
-- the sidebar and on PDF headers.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_bg TEXT;
