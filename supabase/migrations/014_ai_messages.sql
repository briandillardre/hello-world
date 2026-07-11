-- 014: AI assistant conversation history.
-- Each user keeps their own thread with the assistant; RLS locks rows to
-- their auth id. The app degrades to stateless chat if this table is absent,
-- so running this migration simply "turns memory on".

CREATE TABLE IF NOT EXISTS ai_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id    UUID NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_messages_user_time_idx ON ai_messages(user_id, created_at DESC);

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_messages_own ON ai_messages;
CREATE POLICY ai_messages_own ON ai_messages
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
