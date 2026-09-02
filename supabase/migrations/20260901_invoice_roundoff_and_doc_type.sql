-- Two new columns on p2_invoices, both written at generation time by
-- agent-query's confirmGenerateInvoice/confirmConsolidatedInvoice:
--
-- round_off: Section 170 CGST rounding. CGST/SGST/IGST are rounded to the
-- nearest paisa at generation time (see buildInvoiceTotals in agent-query);
-- round_off is the residual needed so the invoice nets to exactly
-- amount_subtotal + amount_gst + round_off = amount_total. Existing rows
-- default to 0 -- no retroactive change to already-emailed invoice totals.
--
-- doc_category: drives Rule 48(1) vs 48(2) copy markings (triplicate for
-- goods, duplicate for services/job work) in invoice.html / js/invoice-pdf.js.
-- Derived once at generation time from the covered dispatch(es)' dispatch_type
-- and movement_purpose -- 'services' for bom_issue/job-work dispatches,
-- 'goods' otherwise (also the default, since goods is the more common case
-- and the safer fallback per the original task spec).

ALTER TABLE p2_invoices
  ADD COLUMN IF NOT EXISTS round_off numeric NOT NULL DEFAULT 0;

ALTER TABLE p2_invoices
  ADD COLUMN IF NOT EXISTS doc_category text NOT NULL DEFAULT 'goods'
    CHECK (doc_category IN ('goods', 'services'));

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
--   Shivprasad (6fe0680a), or Demo (5f021c96).
