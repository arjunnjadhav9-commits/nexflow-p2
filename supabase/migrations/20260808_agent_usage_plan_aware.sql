-- Migration: Plan-aware agent usage limits
-- check_and_increment_agent_usage previously computed the daily limit from
-- agent_tier alone. Plan gating (Lite/Pro/Founder/demo) now drives the limit
-- instead, with agent_tier='unlimited' still overriding everything (test
-- tenant safety) and agent_tier used only as a fallback for tenants with an
-- unexpected/missing plan value.

CREATE OR REPLACE FUNCTION check_and_increment_agent_usage(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tier TEXT;
  v_plan TEXT;
  v_count INT;
  v_reset_date DATE;
  v_limit INT;
BEGIN
  SELECT agent_tier, plan, agent_interactions_today, agent_reset_date
  INTO v_tier, v_plan, v_count, v_reset_date
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

  v_limit := CASE
    WHEN v_tier = 'unlimited' THEN 999999
    WHEN v_plan = 'lite' THEN 0
    WHEN v_plan = 'demo' THEN 20
    WHEN v_plan = 'pro' THEN 50
    WHEN v_plan = 'founder' THEN 30
    WHEN v_tier = 'power' THEN 100
    WHEN v_tier = 'standard' THEN 30
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
