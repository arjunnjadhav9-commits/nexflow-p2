-- Migration: Agent Usage RPC
-- Creates RPC function to atomically check + increment the daily agent
-- interaction counter, with lazy daily reset, before agent-query proceeds.

CREATE OR REPLACE FUNCTION check_and_increment_agent_usage(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tier TEXT;
  v_count INT;
  v_reset_date DATE;
  v_limit INT;
BEGIN
  SELECT agent_tier, agent_interactions_today, agent_reset_date
  INTO v_tier, v_count, v_reset_date
  FROM p2_tenant_settings
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'Tenant not found');
  END IF;

  -- Lazy daily reset
  IF v_reset_date IS DISTINCT FROM CURRENT_DATE THEN
    v_count := 0;
    UPDATE p2_tenant_settings
    SET agent_interactions_today = 0, agent_reset_date = CURRENT_DATE
    WHERE tenant_id = p_tenant_id;
  END IF;

  v_limit := CASE v_tier
    WHEN 'standard' THEN 30
    WHEN 'power' THEN 100
    WHEN 'unlimited' THEN 999999
    ELSE 30
  END;

  IF v_count >= v_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'error', format('Daily limit of %s queries reached. Resets at midnight IST.', v_limit)
    );
  END IF;

  UPDATE p2_tenant_settings
  SET agent_interactions_today = agent_interactions_today + 1
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object('allowed', true, 'remaining', v_limit - v_count - 1);
END;
$$;

-- Grant execute to service_role — agent-query invokes this using SB_SECRET_KEY.
GRANT EXECUTE ON FUNCTION check_and_increment_agent_usage TO service_role;
