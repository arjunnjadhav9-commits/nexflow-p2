-- Per-tenant invoice number format setting (settings.html, Challan Settings
-- tab). DEFAULT 'full' means zero behavior change for every existing tenant
-- unless they explicitly opt into 'short'. Historical invoice_number values
-- are never rewritten — this only changes what get_next_invoice_number's
-- caller builds going forward.

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS invoice_number_format text
  NOT NULL DEFAULT 'full'
  CHECK (invoice_number_format IN ('full', 'short'));

-- get_next_invoice_number now also returns the raw sequence integer, not just
-- the formatted INV-YYYYMM-NNN string. Needed so agent-query can build a
-- non-dated short format (INV-<n>) without re-parsing it back out of the
-- zero-padded string — lpad(v_seq::text, 3, '0') only pads, it never
-- truncates, so once invoice_sequence reaches 1000+ the string is
-- e.g. "...-1000" and a naive "last 3 chars" parse would silently read
-- "000" instead of "1000", colliding with the real low sequence numbers.
--
-- Return-type change requires DROP before CREATE — Postgres rejects
-- CREATE OR REPLACE across a return-type change (text -> TABLE).
--
-- DEPLOYMENT ORDER: apply this in the SQL Editor, then redeploy agent-query
-- immediately after (same hazard class as 20260912_consolidated_invoice_batch_seq.sql).
-- Old agent-query code + this new function = data comes back as an array of
-- rows, and the old code's `invoice_number: invoiceNumber` would insert the
-- array itself. New agent-query code + the old (pre-migration) function =
-- data is a bare string, and `seqRows?.[0]` would silently return its first
-- character. Neither failure mode throws loudly, so don't leave the two out
-- of sync.
DROP FUNCTION IF EXISTS get_next_invoice_number(uuid);

CREATE FUNCTION get_next_invoice_number(p_tenant_id uuid)
RETURNS TABLE(invoice_number text, sequence_number integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_seq integer;
BEGIN
  SELECT invoice_sequence + 1 INTO v_seq
  FROM p2_tenant_settings
  WHERE tenant_id = p_tenant_id FOR UPDATE;
  UPDATE p2_tenant_settings SET invoice_sequence = v_seq
  WHERE tenant_id = p_tenant_id;
  RETURN QUERY SELECT
    'INV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM') || '-' || lpad(v_seq::text, 3, '0'),
    v_seq;
END;$$;

-- Restated after CREATE — same defensive convention as every other
-- CREATE (OR REPLACE) FUNCTION migration in this codebase.
GRANT EXECUTE ON FUNCTION get_next_invoice_number(uuid) TO service_role;

-- Run this in Supabase SQL Editor as postgres role — never `supabase db push`.
-- Confirmed via grep: the only two callers of get_next_invoice_number are
-- confirmGenerateInvoice and confirmConsolidatedInvoice in
-- supabase/functions/agent-query/index.ts — both updated in the same change
-- that this migration ships alongside.
