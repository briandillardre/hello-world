-- 081: owner_memos.mailed_at — repairs a migration-freeze burn (Aug 28).
-- 080 was applied to the production DB by a PREVIEW build of the branch
-- BEFORE mailed_at was added to the file; the production build then saw
-- 080 as already-applied and skipped it, leaving the column missing.
-- ensureOwnerMemo's read selects mailed_at, so every memo request 400'd
-- (swallowed as "pre-080 database") and the /finance card never showed.
-- Lesson recorded in CLAUDE.md: a migration file is FROZEN the moment any
-- push carries it — previews run migrate against the same database.

ALTER TABLE owner_memos ADD COLUMN IF NOT EXISTS mailed_at TIMESTAMPTZ;
