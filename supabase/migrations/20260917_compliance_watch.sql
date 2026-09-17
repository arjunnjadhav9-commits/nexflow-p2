-- Session A2 — Compliance monitoring. Two tables, both service-role only, no
-- tenant_id: statutory change is global, not per-tenant — same shape as
-- p2_ops_alerts (Session A0, 20260917_ops_alerts.sql). Apply by hand in the
-- Supabase SQL Editor — never `supabase db push` (replays old migrations).
--
-- Schema per _ai/compliance-monitoring.md §6, which supersedes
-- automation-strategy.md §4.2's simpler sample: effective_date is tracked
-- separately from published_at because the B2CL miss (22 months wrong) was a
-- miss against the EFFECTIVE date, not the publish date. haiku_proposed /
-- opus_confirmed / opus_reason are the audit trail for rule R1a — Opus may
-- only demote a proposed CRITICAL to IMPORTANT, never promote — without
-- these columns there is no record of what Opus actually decided.
CREATE TABLE p2_compliance_watch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Widened 2026-09-17 before this migration was ever applied (table did
  -- not exist live yet, so this is an in-place edit, not an ALTER): 'cbic'
  -- split into 'cbic_rate' and 'cbic_central' — two distinct CBIC
  -- notification series, confirmed as separate static-HTML sources. See
  -- compliance-monitoring.md §5.
  source          text NOT NULL CHECK (source IN ('cbic_rate','cbic_central','gstn')),
  doc_id          text NOT NULL,        -- notification number, or a stable hash of the URL
  title           text NOT NULL,
  url             text NOT NULL,
  published_at    date,
  effective_date  date,                 -- often later than published_at, and it is what matters

  -- Model output
  summary         text,                 -- Haiku, plain English, <= 60 words
  area            text,                 -- matched _ai/compliance-constants.json area, or 'none'
  classification  text NOT NULL DEFAULT 'monitor'
                    CHECK (classification IN ('critical','important','monitor')),
  haiku_proposed  text,                 -- what Haiku said before the Opus gate
  opus_confirmed  boolean,              -- NULL when no CRITICAL was proposed

  -- Outcome
  issue_url       text,
  status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','issue_opened','actioned','dismissed')),
  dismissed_reason text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source, doc_id)               -- dedup: same notification never processed twice
);

ALTER TABLE p2_compliance_watch ENABLE ROW LEVEL SECURITY;
-- No policy. Service role bypasses RLS; nothing else may read it.
REVOKE ALL ON p2_compliance_watch FROM anon, authenticated;

CREATE INDEX p2_compliance_watch_recent_idx
  ON p2_compliance_watch (published_at DESC);
CREATE INDEX p2_compliance_watch_open_idx
  ON p2_compliance_watch (classification, status)
  WHERE status IN ('new','issue_opened');

-- Fetch-failure counter for the "feed unreachable for 2 consecutive weekly
-- runs" alert. Deliberately a separate one-row table, not a sentinel
-- doc_id='__fetch_error__' row inside p2_compliance_watch: that table's
-- UNIQUE(source, doc_id) and its classification/status logic exist entirely
-- to describe real notifications (the weekly digest fold-in, the CA
-- confirmation register, any future "open items" view) — a synthetic row
-- would need special-casing in every query against it. Survives a function
-- restart identically; a real row here is the only state a restart needs.
CREATE TABLE p2_compliance_scan_state (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  consecutive_failures  int NOT NULL DEFAULT 0,
  last_attempt_at       timestamptz,
  last_success_at       timestamptz
);

INSERT INTO p2_compliance_scan_state (id) VALUES (true);

ALTER TABLE p2_compliance_scan_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON p2_compliance_scan_state FROM anon, authenticated;

-- p2_ops_alerts.source CHECK — deliberately NOT widened here. Confirmed
-- 2026-09-17 via 20260917_ops_alerts.sql (the live migration) and
-- supabase/functions/_shared/ops.ts's OpsSource type: both independently
-- already list 'compliance' among the 11 values on that CHECK. Run
-- `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname =
-- 'p2_ops_alerts_source_check';` by hand once before relying on this if you
-- want a third confirmation — this migration does not touch that table.
