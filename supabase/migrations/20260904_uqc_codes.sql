-- Fix 3 — UQC codes on materials and products.
-- ITC-04 requires GSTN UQC codes (NOS, KGS, MTR, PCS...) not free-text
-- units. uqc is a separate column from the existing display `unit` —
-- unit stays free text for on-screen/challan display, uqc is the
-- controlled GSTN code used only for the ITC-04 export.

ALTER TABLE p2_raw_materials ADD COLUMN IF NOT EXISTS uqc text;
ALTER TABLE p2_products ADD COLUMN IF NOT EXISTS uqc text;

-- Backfill common mappings where possible.
UPDATE p2_raw_materials SET uqc = 'KGS' WHERE LOWER(unit) IN ('kg', 'kgs', 'kilogram', 'kilograms');
UPDATE p2_raw_materials SET uqc = 'NOS' WHERE LOWER(unit) IN ('nos', 'no', 'number', 'numbers', 'pcs', 'pieces', 'piece');
UPDATE p2_raw_materials SET uqc = 'MTR' WHERE LOWER(unit) IN ('mtr', 'mts', 'meter', 'meters', 'metre', 'metres', 'm');
UPDATE p2_raw_materials SET uqc = 'LTR' WHERE LOWER(unit) IN ('ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'l');

UPDATE p2_products SET uqc = 'KGS' WHERE LOWER(unit) IN ('kg', 'kgs', 'kilogram', 'kilograms');
UPDATE p2_products SET uqc = 'NOS' WHERE LOWER(unit) IN ('nos', 'no', 'number', 'numbers', 'pcs', 'pieces', 'piece');
UPDATE p2_products SET uqc = 'MTR' WHERE LOWER(unit) IN ('mtr', 'mts', 'meter', 'meters', 'metre', 'metres', 'm');
UPDATE p2_products SET uqc = 'LTR' WHERE LOWER(unit) IN ('ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'l');

-- Anything not recognized by the four mappings above (e.g. Stack, Stator,
-- SQM, CBM, or a free-text value someone typed) becomes an explicit 'OTH'
-- rather than being left NULL. NULL and OTH mean different things: OTH is
-- "checked, doesn't map cleanly to a standard code" — NULL is "never set."
-- The settings.html / products.html warning banners count only uqc IS NULL,
-- so this keeps that count accurate after this migration runs — existing
-- rows never trigger it again; only genuinely never-saved rows do.
UPDATE p2_raw_materials SET uqc = 'OTH' WHERE uqc IS NULL;
UPDATE p2_products SET uqc = 'OTH' WHERE uqc IS NULL;
