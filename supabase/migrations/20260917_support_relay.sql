-- A4 Phase 1 — Support relay.
-- Three tables: p2_support_threads (one row per conversation),
-- p2_support_messages (append-only, one row per turn), p2_support_kb (draft
-- rows accreted from every founder reply — read by nothing yet; Phase 2
-- builds the retrieval side against this table). Apply by hand in the
-- Supabase SQL Editor — never `supabase db push` (replays old migrations).
--
-- All writes to these three tables go through agent-query/index.ts
-- (submit_support_message, submit_bug_report) or telegram-webhook/index.ts
-- (the /reply branch) — both on the service-role key, both bypass RLS. RLS
-- is still enabled and policied on the two tenant-facing tables from day
-- one (no page reads them yet, but the discipline this project enforces
-- after the RLS-never-enabled incident is: every new table gets it
-- immediately, not when a reader shows up). p2_support_kb is founder-internal
-- only, same service-role-only shape as p2_ops_alerts/p2_compliance_watch.

-- ── p2_support_threads ───────────────────────────────────────────────────────
CREATE TABLE p2_support_threads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES p2_tenants(id),
  channel           text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app')),
  -- WhatsApp is blocked on P3 (WhatsApp Business Cloud API access,
  -- automation-strategy.md §8) — this column exists now so widening the
  -- CHECK later is the only change needed, not a new column.
  kind              text NOT NULL DEFAULT 'question' CHECK (kind IN ('question','bug')),
  status            text NOT NULL DEFAULT 'awaiting_founder'
                      CHECK (status IN ('awaiting_founder','awaiting_client','closed')),
  -- Captured client-side from localStorage.getItem('nexflow_lang') at submit
  -- time — there is no durable preferred_lang column anywhere server-side
  -- (CLAUDE.md Known Open Items #24) and this does not need one, since a
  -- live browser session is always present when a thread is created.
  lang              text NOT NULL DEFAULT 'en' CHECK (lang IN ('en','mr')),
  github_issue_url  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_support_threads ENABLE ROW LEVEL SECURITY;

-- get_my_tenant_id() pattern (not auth.uid()) — same reference implementation
-- as p2_notifications/p2_filing_packages. SELECT only: no page reads this
-- yet, but every tenant-scoped table gets RLS from creation, not from when a
-- reader shows up. No INSERT/UPDATE/DELETE policy — every write is
-- service-role (agent-query, telegram-webhook), which bypasses RLS entirely.
CREATE POLICY "support_threads_select" ON p2_support_threads
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_p2_support_threads_tenant ON p2_support_threads (tenant_id);

-- ── p2_support_messages ──────────────────────────────────────────────────────
CREATE TABLE p2_support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised alongside thread_id so RLS can filter directly on this
  -- table without a join back to p2_support_threads — same reasoning
  -- p2_dispatch_items carries its own tenant_id despite always having a
  -- parent header row.
  tenant_id   uuid NOT NULL REFERENCES p2_tenants(id),
  thread_id   uuid NOT NULL REFERENCES p2_support_threads(id),
  role        text NOT NULL CHECK (role IN ('client','founder')),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_support_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_messages_select" ON p2_support_messages
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_p2_support_messages_thread ON p2_support_messages (thread_id, created_at);

-- ── p2_support_kb ─────────────────────────────────────────────────────────────
-- Draft-only in Phase 1: every founder /reply in telegram-webhook writes one
-- row here, status='unreviewed'. Nothing reads this table yet — Phase 2
-- builds both the review surface (settings.html) and the retrieval query
-- (support_query action on agent-query) against it. thread_id is nullable
-- because a future manually-authored KB row (Phase 2) may not derive from
-- any real thread.
CREATE TABLE p2_support_kb (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid REFERENCES p2_support_threads(id),
  question    text NOT NULL,
  answer      text NOT NULL,
  lang        text NOT NULL DEFAULT 'en' CHECK (lang IN ('en','mr')),
  status      text NOT NULL DEFAULT 'unreviewed' CHECK (status IN ('unreviewed','approved','rejected')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_support_kb ENABLE ROW LEVEL SECURITY;
-- No policy. Service role bypasses RLS; nothing else may read it — a
-- client's own answered question is founder-internal knowledge-base
-- material, not something that tenant (or any other) can query back.
-- Same shape as p2_ops_alerts / p2_compliance_watch.
REVOKE ALL ON p2_support_kb FROM anon, authenticated;

-- ── p2_notifications — new notification type ────────────────────────────────
-- Live definition read in the SQL Editor for this session, Sept 17 2026:
--   CHECK ((type = ANY (ARRAY['challan_dispatched'::text, 'payment_overdue'::text,
--     'low_stock'::text, 'filing_package_ready'::text, 'email_bounced'::text])))
-- Widening keeps every existing value and adds exactly one, 'support_reply'.
-- Per execution-plan.md §10 item 3, any later session widening this same
-- CHECK is responsible for reading its own live definition at that time.
ALTER TABLE p2_notifications DROP CONSTRAINT p2_notifications_type_check;
ALTER TABLE p2_notifications ADD CONSTRAINT p2_notifications_type_check
  CHECK (type = ANY (ARRAY[
    'challan_dispatched','payment_overdue','low_stock',
    'filing_package_ready','email_bounced','support_reply'
  ]));
