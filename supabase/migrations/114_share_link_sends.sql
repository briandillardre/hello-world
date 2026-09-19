-- 114 — share_link_sends: who was sent which shared map view, and when.
--
-- sec-check on 113 (Sep 19): sendViewLinkAction pushed to up to 25 teammates
-- per call with nothing counting the calls — a scripted member could flood
-- every phone on the roster. One row per recipient per send gives the two
-- caps a place to count from (≤ 100 recipients per link, ≤ 100 sends per
-- sender per day) and doubles as the audit trail the Team page can read
-- later ("Brian sent this to 3 people at 4:12 PM").
--
-- Service role only, same shape as share_links: RLS on, no policies, every
-- write through a server action that has already resolved the caller.

CREATE TABLE IF NOT EXISTS public.share_link_sends (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     TEXT NOT NULL REFERENCES public.share_links(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient   UUID NOT NULL,
  -- False when the person had no phone in the app: recorded so the sender's
  -- "who did this reach" is honest, and so the cap counts attempts, not luck.
  delivered   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS share_link_sends_link_idx   ON public.share_link_sends (link_id);
CREATE INDEX IF NOT EXISTS share_link_sends_sender_idx ON public.share_link_sends (sender, created_at DESC);

ALTER TABLE public.share_link_sends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  REVOKE ALL ON TABLE public.share_link_sends FROM anon, authenticated;
EXCEPTION
  WHEN undefined_object OR insufficient_privilege THEN
    RAISE NOTICE '114: share_link_sends grants left as-is (%)', SQLERRM;
END $$;
