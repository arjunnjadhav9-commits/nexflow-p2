-- E3 — HSN Audit Tool. Provenance column for HSN/SAC codes on raw materials
-- and products. Nullable, no default — existing rows predate this feature
-- and stay NULL (display logic treats NULL as 'manual', DB is never
-- backfilled). Written client-side only, on two occasions:
--   - export.html's HSN Audit: sets 'ai_verified' when Haiku confirms an
--     existing code is correct.
--   - settings.html / products.html (future session, not built yet): sets
--     'ai_corrected' when a user manually fixes a code the audit flagged.
-- Never written by a trigger.

ALTER TABLE p2_raw_materials ADD COLUMN IF NOT EXISTS hsn_source text
  CHECK (hsn_source IN ('manual','imported','ai_verified','ai_corrected'));
ALTER TABLE p2_products ADD COLUMN IF NOT EXISTS hsn_source text
  CHECK (hsn_source IN ('manual','imported','ai_verified','ai_corrected'));

-- Run this in Supabase SQL Editor as postgres role — never `supabase db push`.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
--   Shivprasad (6fe0680a), or Demo (5f021c96) until verified on test tenant.
