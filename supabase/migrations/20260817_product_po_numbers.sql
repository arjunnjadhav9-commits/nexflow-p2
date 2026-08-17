-- Per-product default PO number — auto-fills on dispatch, editable per dispatch
ALTER TABLE p2_products ADD COLUMN IF NOT EXISTS default_po_number TEXT;

-- Per-dispatch-item PO number override (stores the actual dispatched PO per line)
ALTER TABLE p2_dispatch_items ADD COLUMN IF NOT EXISTS po_number TEXT;
