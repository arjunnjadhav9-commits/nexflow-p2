-- PostgreSQL Function: get_next_challan_number
-- Purpose: Safely increment and return the next challan number for a tenant
-- Ensures no two challans get the same number even with concurrent dispatches

CREATE OR REPLACE FUNCTION get_next_challan_number(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_next_number integer;
BEGIN
    -- Lock the tenant settings row for this tenant to prevent concurrent updates
    -- FOR UPDATE ensures exclusive access during the transaction
    UPDATE p2_tenant_settings
    SET challan_sequence = challan_sequence + 1
    WHERE tenant_id = p_tenant_id
    RETURNING challan_sequence INTO v_next_number;

    -- If no row exists yet, create one with initial sequence 1
    IF v_next_number IS NULL THEN
        INSERT INTO p2_tenant_settings (tenant_id, challan_sequence)
        VALUES (p_tenant_id, 1)
        ON CONFLICT (tenant_id) DO UPDATE
        SET challan_sequence = p2_tenant_settings.challan_sequence + 1
        RETURNING challan_sequence INTO v_next_number;
    END IF;

    RETURN v_next_number;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_next_challan_number(uuid) TO authenticated;

-- Example usage:
-- SELECT get_next_challan_number('your-tenant-id-here');
-- This will return 1 on first call, 2 on second call, etc.
