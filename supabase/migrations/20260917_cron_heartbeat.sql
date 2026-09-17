-- A3 — ops-digest heartbeat tracking. Lets the digest detect a cron that
-- silently stopped firing ("the failure this codebase is most likely to
-- actually have" per automation-strategy.md §4.3) instead of only detecting
-- failures the function itself was still alive enough to report.
--
-- Scope this session: wired into 2 of the 6 existing cron-triggered
-- functions (check-low-stock, filing-package) — the rest (compliance-scan,
-- schema-drift, notify) get the same one-line recordHeartbeat() call added
-- later, fast-follow, per execution-plan.md-session decision. Apply by hand
-- in the Supabase SQL Editor — never `supabase db push` (replays old
-- migrations).
--
-- Deliberately no tenant_id — this is operational infrastructure describing
-- Nexflow's own crons, not client data. Same shape as p2_ops_alerts and
-- p2_job_queue: RLS enabled, no policy, service-role only.
CREATE TABLE p2_cron_heartbeat (
  job_name              text PRIMARY KEY,
  last_success_at       timestamptz,
  last_attempt_at       timestamptz NOT NULL DEFAULT now(),
  last_status           text NOT NULL DEFAULT 'unknown'
                          CHECK (last_status IN ('ok', 'error', 'unknown')),
  last_error            text,
  -- e.g. 1440 for a job expected roughly daily. ops-digest flags a job whose
  -- last_success_at is older than 2x this, not 1x, so a cron running a few
  -- hours late on a slow day doesn't false-positive.
  expected_interval_min int NOT NULL
);

ALTER TABLE p2_cron_heartbeat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON p2_cron_heartbeat FROM anon, authenticated;

-- Seed the two jobs wired this session. recordHeartbeat() only ever upserts
-- an existing row (merge-duplicates on job_name) — a job_name with no seed
-- row here would hit the NOT NULL on expected_interval_min on first write
-- and fail closed (logged, never thrown), which is a deliberate signal that
-- a new cron was wired into recordHeartbeat() without being seeded here.
INSERT INTO p2_cron_heartbeat (job_name, expected_interval_min) VALUES
  ('check-low-stock', 1440),
  ('filing-package', 1440);
