-- A6 — Filing package dispatcher + drain queue.
-- Generic job queue, service-role only. job_type CHECK already includes
-- 'onboarding_parse' so A1 (onboarding ingestion) can reuse this table and
-- claim_job_queue() unmodified when it's built. tenant_id has no FK — A1
-- submissions can precede a tenant existing, and this avoids the FK-vs-RLS
-- trap already documented in CLAUDE.md (FKs to p2_tenants were dropped from
-- p2_stock_transactions for exactly this reason).

CREATE TABLE p2_job_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type     text NOT NULL CHECK (job_type IN ('filing_package','onboarding_parse')),
  tenant_id    uuid,
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','failed','dead')),
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  claimed_at   timestamptz,
  error_reason text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_type, dedupe_key)
);

ALTER TABLE p2_job_queue ENABLE ROW LEVEL SECURITY;
-- Service-role only — same pattern as p2_ops_alerts (confirmed live:
-- relrowsecurity=true, zero grants to anon/authenticated, no policies).
REVOKE ALL ON p2_job_queue FROM anon, authenticated;

CREATE INDEX p2_job_queue_claim_idx ON p2_job_queue (job_type, status, created_at)
  WHERE status = 'queued';

-- FOR UPDATE SKIP LOCKED isn't expressible through PostgREST — needs a
-- SECURITY DEFINER RPC, same discipline confirm_bom_issue already uses for
-- its own stock-sufficiency lock. Generic on job_type so A1 reuses this
-- unmodified for 'onboarding_parse'.
CREATE OR REPLACE FUNCTION claim_job_queue(p_job_type text, p_limit int DEFAULT 3)
RETURNS SETOF p2_job_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE p2_job_queue
  SET status = 'running', claimed_at = now(), attempts = attempts + 1, updated_at = now()
  WHERE id IN (
    SELECT id FROM p2_job_queue
    WHERE job_type = p_job_type AND status = 'queued'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_job_queue(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_job_queue(text, int) TO service_role;
