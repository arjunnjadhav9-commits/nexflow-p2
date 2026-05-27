# Nexflow Automations — P2 Raw Material & Inventory Tracker
## Project Overview
SaaS product for MIDC factory owners (Maharashtra, India).
Multi-tenant: each factory owner is one tenant with isolated data.
Language: English UI with a toggle switch for Marathi UI.
Mobile-first: owners use phones. Must work on mobile browser.
Light mode: It should also have a toggle switch for light mode.
## Tech Stack- Frontend: Plain HTML + Tailwind CSS (CDN) — NO React, NO build tools- Backend: Supabase (PostgreSQL + Edge Functions + Storage + Auth)- Hosting: Vercel (static HTML files)- Notifications: Telegram Bot API- AI/Automation: None in product itself
## Supabase Config- Project name: nexflow-p2- All tables use prefix: p2_- Multi-tenancy via tenant_id column + Row Level Security (RLS) on all tables- Auth: Supabase Auth (email/password). tenant_id stored in user metadata.
## Brand- Company: Nexflow Automations- Colors: Teal #00BCD4, Green #00E676, Dark BG #1A1F2E, Text #E0E0E0, Muted #94A3B8- Logo: /public/assets/nexflow_logo_transparent.png (height 36px in navbar)- Favicon: /public/assets/favicon.ico
## Database Tables (all with p2_ prefix)
p2_tenants — each factory owner account
p2_tenant_settings — company name, address, logo_url, challan_sequence, GSTIN
p2_raw_materials — raw material master (name, unit, min_stock_level)
p2_suppliers — supplier master
p2_stock_transactions — every GRN/consumption/adjustment (append-only log)
p2_products — finished goods the factory makes
p2_product_bom — recipe: qty of each raw material per unit of product
p2_dispatch_orders — each dispatch = one challan
p2_dispatch_items — line items in a dispatch
## Key Business Rules- Stock balance = SUM of all p2_stock_transactions for that material (never store balance directly)- On dispatch CONFIRM: Edge Function reads BOM, inserts negative stock_transactions- Challan header: 100% from p2_tenant_settings — ZERO hardcoding of client details- Telegram alert when stock < min_stock_level after any deduction- CA Report: opening stock + GRN - consumption = closing stock (must reconcile)
## Language Toggle
- Every HTML page must support English/Marathi toggle
- Toggle button top-right, below navbar, teal #00BCD4
- All translatable elements use data-en="..." and data-mr="..." attributes
- Toggle state stored in localStorage key 'nexflow_lang'
- On page load: read localStorage, apply saved language
- Default language: English
- A shared js/lang.js file handles the toggle logic for all pages
- Every page imports js/lang.js and calls initLang() on DOMContentLoaded
## Pricing (DO NOT expose in UI)
Setup: Rs 20000 | Annual: Rs 40000/yr | AMC: Rs 4000/yr | Monthly(if not billed anually): Rs 4000/month
## Pages
index.html — dashboard (stock overview)
grn.html — receive materials
dispatch.html — dispatch products (BOM auto-deduction)
challan.html — printable delivery challan (?id=dispatch_order_id)
products.html — manage products + BOM
ca-report.html — CA audit report (?from=DATE&to;=DATE)
settings.html — tenant settings + logo upload
