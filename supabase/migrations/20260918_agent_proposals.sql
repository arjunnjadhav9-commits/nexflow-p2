-- W2 — Agent write layer proposal store. One row per proposed transaction.
-- Holds the RESOLVED, SERVER-COMPUTED plan -- never the model's raw output as the
-- thing that gets executed (that is kept alongside, for audit only).
-- RLS shape copied from p2_notifications, the reference implementation in this
-- schema: three command-scoped policies on get_my_tenant_id(), no DELETE,
-- RLS explicitly enabled in this same migration.
-- Schema per _ai/nexflow-agent.md §8.1, verbatim.
CREATE TABLE p2_agent_proposals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  user_id           uuid NOT NULL REFERENCES auth.users(id),
  kind              text NOT NULL CHECK (kind IN ('grn')),
                      -- deliberately single-valued: GRN is the only surviving write intent
                      -- (scope finalized 18 Sept 2026). Widen this CHECK if a future write
                      -- intent is ever added; do not remove the column.
  status            text NOT NULL DEFAULT 'awaiting_confirmation' CHECK (status IN
                      ('awaiting_confirmation','executing','executed','cancelled',
                       'superseded','expired','failed')),

  model_input       jsonb NOT NULL,   -- the tool_use.input verbatim. AUDIT ONLY.
                                      -- Never read on the confirm path.
  plan              jsonb NOT NULL,   -- the resolved plan. THIS is what executes.
  confirm_text      text   NOT NULL,  -- the card as shown, verbatim. The audit answer to
                                      -- "what exactly did my supervisor approve?"
  warnings          jsonb NOT NULL DEFAULT '[]',  -- amber flags shown on the card

  challan_number    text,             -- drawn once at first confirm, reused on retry
                                      -- (Known Open Items #15, fixed by construction)
  supersedes        uuid REFERENCES p2_agent_proposals(id),
  source            text NOT NULL DEFAULT 'photo' CHECK (source IN ('photo','qr')),
                      -- 'text' dropped — GRN can no longer be initiated by a typed message,
                      -- only by a photo (§5.2) or a QR scan (§5.6). A later clarification
                      -- answer within an already-open proposal is still typed text, but that
                      -- doesn't change the proposal's origin.
  image_paths       text[],           -- agent-uploads storage paths, 90-day retention
  model_used        text,             -- 'claude-haiku-4-5' | 'claude-sonnet-5' | ...
  input_tokens      integer,
  output_tokens     integer,
  escalated         boolean NOT NULL DEFAULT false,

  result            jsonb,            -- RPC return on success
  error_reason      text,
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_agent_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_agent_proposals_select ON p2_agent_proposals
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_agent_proposals_insert ON p2_agent_proposals
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_agent_proposals_update ON p2_agent_proposals
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
             WITH CHECK (tenant_id = get_my_tenant_id());
-- No DELETE policy, deliberately. A proposal is an audit record.

-- Finds the single live proposal for a user. The §4.2 typed-confirmation path
-- depends on this being exactly one row.
CREATE UNIQUE INDEX p2_agent_proposals_live_idx
  ON p2_agent_proposals (tenant_id, user_id)
  WHERE status = 'awaiting_confirmation';

CREATE INDEX p2_agent_proposals_tenant_created_idx
  ON p2_agent_proposals (tenant_id, created_at DESC);

-- tenant_id is passed EXPLICITLY by the Edge Function on insert. No set_tenant_id()
-- trigger is attached -- same decision and same reasoning as p2_notifications: a
-- trigger deriving from get_my_tenant_id() clobbers a service-role insert's explicit
-- tenant_id with NULL, because there is no auth.uid() in that context.
