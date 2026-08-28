-- 080: owner memos — the Growth Platform's "what lever next" advisor made
-- concrete (docs/GROWTH-PLATFORM.md; Brian, Aug 27: "go ahead with your
-- best ideas"). One memo per company per month: a short AI-written owner
-- read grounded ONLY in computed facts (metrics spine, ledger, benchmarks,
-- live findings) — the facts snapshot is stored beside the text so every
-- claim in the memo is auditable against the numbers it was given.
--
-- Members with the cost permission read; only the service-role composer
-- writes (cron + regenerate route) — same posture as 079.

CREATE TABLE IF NOT EXISTS owner_memos (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- First day of the local month the memo belongs to.
  month DATE NOT NULL,
  memo TEXT NOT NULL,
  -- The exact fact bag the composer saw — the audit trail for every number.
  facts JSONB NOT NULL DEFAULT '{}',
  -- 'ai', 'plain' (deterministic fallback when no API key), or 'pending'
  -- (compose-slot claim while a runner is mid-compose — never shown).
  composer TEXT NOT NULL DEFAULT 'plain',
  -- Stamped by the monthly cron after the email sends, so a re-run
  -- (manual kick, platform retry) never re-mails the same memo.
  mailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, month)
);

ALTER TABLE owner_memos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company memos read" ON owner_memos;
CREATE POLICY "company memos read" ON owner_memos
  FOR SELECT USING (company_id = current_company_id());
