-- Migration: Create dispatch tables and update tenant settings for challan sequence
-- Part 1: Ensure dispatch tables exist with correct schema

-- p2_dispatch_orders table
CREATE TABLE IF NOT EXISTS p2_dispatch_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES p2_tenants(id) ON DELETE CASCADE,
    client_name TEXT NOT NULL,
    client_address TEXT NOT NULL,
    po_number TEXT,
    your_challan_ref TEXT,
    challan_number TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- p2_dispatch_items table
CREATE TABLE IF NOT EXISTS p2_dispatch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_order_id UUID NOT NULL REFERENCES p2_dispatch_orders(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES p2_tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES p2_products(id) ON DELETE RESTRICT,
    quantity NUMERIC NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add challan_sequence column to p2_tenant_settings if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'p2_tenant_settings'
        AND column_name = 'challan_sequence'
    ) THEN
        ALTER TABLE p2_tenant_settings ADD COLUMN challan_sequence INTEGER DEFAULT 0;
    END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_tenant ON p2_dispatch_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_status ON p2_dispatch_orders(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_items_dispatch ON p2_dispatch_items(dispatch_order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_items_tenant ON p2_dispatch_items(tenant_id);

-- Enable Row Level Security
ALTER TABLE p2_dispatch_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_dispatch_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for p2_dispatch_orders
DROP POLICY IF EXISTS "Users can view their tenant's dispatch orders" ON p2_dispatch_orders;
CREATE POLICY "Users can view their tenant's dispatch orders"
    ON p2_dispatch_orders FOR SELECT
    USING (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::UUID);

DROP POLICY IF EXISTS "Users can insert their tenant's dispatch orders" ON p2_dispatch_orders;
CREATE POLICY "Users can insert their tenant's dispatch orders"
    ON p2_dispatch_orders FOR INSERT
    WITH CHECK (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::UUID);

DROP POLICY IF EXISTS "Users can update their tenant's dispatch orders" ON p2_dispatch_orders;
CREATE POLICY "Users can update their tenant's dispatch orders"
    ON p2_dispatch_orders FOR UPDATE
    USING (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::UUID);

-- RLS Policies for p2_dispatch_items
DROP POLICY IF EXISTS "Users can view their tenant's dispatch items" ON p2_dispatch_items;
CREATE POLICY "Users can view their tenant's dispatch items"
    ON p2_dispatch_items FOR SELECT
    USING (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::UUID);

DROP POLICY IF EXISTS "Users can insert their tenant's dispatch items" ON p2_dispatch_items;
CREATE POLICY "Users can insert their tenant's dispatch items"
    ON p2_dispatch_items FOR INSERT
    WITH CHECK (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::UUID);

DROP POLICY IF EXISTS "Users can update their tenant's dispatch items" ON p2_dispatch_items;
CREATE POLICY "Users can update their tenant's dispatch items"
    ON p2_dispatch_items FOR UPDATE
    USING (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::UUID);

DROP POLICY IF EXISTS "Users can delete their tenant's dispatch items" ON p2_dispatch_items;
CREATE POLICY "Users can delete their tenant's dispatch items"
    ON p2_dispatch_items FOR DELETE
    USING (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::UUID);
