-- Session A0 — Founder ops alerts. Deliberately has NO tenant_id: this is
-- founder-scoped infrastructure, not client data, and must never appear in
-- any tenant surface. Applied by hand in the Supabase SQL Editor — never
-- `supabase db push`.
--
-- source CHECK carries all 11 values the roadmap will ever need (not just the
-- 7 automations A0 ships for) — see execution-plan.md §10 item 3, which
-- documents the exact ALTER-CONSTRAINT collision this pre-empts.
CREATE TABLE p2_ops_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL CHECK (source IN
                    ('compliance','digest','filing','health','onboarding','support',
                     'billing','bridge','agent','factory','intelligence')),
  severity        text NOT NULL CHECK (severity IN ('critical','important','monitor')),
  title           text NOT NULL,
  body            text NOT NULL,
  dedupe_key      text,
  meta            jsonb NOT NULL DEFAULT '{}',
  delivered       boolean NOT NULL DEFAULT false,
  error_reason    text,
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_ops_alerts ENABLE ROW LEVEL SECURITY;
-- No policy created. Service role bypasses RLS; anon/authenticated see nothing.
REVOKE ALL ON p2_ops_alerts FROM anon, authenticated;

CREATE INDEX p2_ops_alerts_dedupe_idx ON p2_ops_alerts (source, dedupe_key, created_at DESC);
CREATE INDEX p2_ops_alerts_recent_idx ON p2_ops_alerts (created_at DESC);
