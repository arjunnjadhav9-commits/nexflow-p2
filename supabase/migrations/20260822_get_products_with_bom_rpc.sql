CREATE OR REPLACE FUNCTION get_products_with_bom(p_tenant_id uuid)
RETURNS TABLE(product_id uuid)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT product_id
  FROM p2_product_bom
  WHERE tenant_id = p_tenant_id;
$$;
