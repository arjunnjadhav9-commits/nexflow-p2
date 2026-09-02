-- get_next_invoice_number used now() (UTC) for the YYYYMM segment of the
-- invoice number. An invoice generated at, say, 1 Oct 00:30 IST (30 Sep
-- 19:00 UTC) was numbered INV-202609-XXX instead of INV-202610-XXX.
--
-- Fix: only the to_char() timezone conversion for the YYYYMM format string.
-- The row-locked sequence counter logic (FOR UPDATE, invoice_sequence + 1,
-- the UPDATE) is untouched -- same shape as get_next_grn_number.

CREATE OR REPLACE FUNCTION get_next_invoice_number(p_tenant_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_seq integer;
BEGIN
  SELECT invoice_sequence + 1 INTO v_seq
  FROM p2_tenant_settings
  WHERE tenant_id = p_tenant_id FOR UPDATE;
  UPDATE p2_tenant_settings SET invoice_sequence = v_seq
  WHERE tenant_id = p_tenant_id;
  RETURN 'INV-' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM') || '-' || lpad(v_seq::text, 3, '0');
END;$$;

-- Restated after CREATE OR REPLACE -- same convention as every other
-- CREATE OR REPLACE FUNCTION migration in this codebase (grants do not
-- automatically survive a function replace in all Postgres versions/setups,
-- so this is always re-stated defensively).
GRANT EXECUTE ON FUNCTION get_next_invoice_number TO service_role;

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
--   Shivprasad (6fe0680a), or Demo (5f021c96).
