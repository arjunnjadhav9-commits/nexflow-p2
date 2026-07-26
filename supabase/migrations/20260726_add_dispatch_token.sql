ALTER TABLE p2_dispatch_orders
  ADD COLUMN IF NOT EXISTS dispatch_token uuid DEFAULT gen_random_uuid();

UPDATE p2_dispatch_orders
SET dispatch_token = gen_random_uuid()
WHERE dispatch_token IS NULL;

ALTER TABLE p2_dispatch_orders
  ALTER COLUMN dispatch_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS p2_dispatch_orders_dispatch_token_idx
  ON p2_dispatch_orders (dispatch_token);
