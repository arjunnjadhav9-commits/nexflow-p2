ALTER TABLE p2_stock_transactions
ADD COLUMN IF NOT EXISTS purchase_type text
NOT NULL DEFAULT 'intrastate'
CHECK (purchase_type IN ('intrastate', 'interstate'));
