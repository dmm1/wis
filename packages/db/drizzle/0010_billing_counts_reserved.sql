-- Adds `reserved_invitations` (open invitations that reserve a seat) so screens can split
-- "in use" from "reserved" without duplicating the counting rules. user_only still includes them.
DROP FUNCTION tenant_billing_counts(text);
--> statement-breakpoint
CREATE FUNCTION tenant_billing_counts(p_tenant text)
RETURNS TABLE (employee_with_login integer, employee_no_login integer, user_only integer, reserved_invitations integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  WITH active_emp AS (
    SELECT e.id, e.user_id, lower(e.email) AS email
    FROM employee e
    WHERE e.tenant_id = p_tenant
      AND (e.start_date IS NULL OR e.start_date <= current_date)
      AND (e.end_date IS NULL OR e.end_date >= current_date)
  ),
  mem AS (SELECT m.user_id FROM member m WHERE m.organization_id = p_tenant),
  with_login AS (SELECT a.id FROM active_emp a WHERE a.user_id IN (SELECT user_id FROM mem)),
  open_inv AS (
    SELECT lower(i.email) AS email
    FROM invitation i
    WHERE i.organization_id = p_tenant AND i.status = 'pending' AND i.expires_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM member m JOIN "user" u ON u.id = m.user_id
        WHERE m.organization_id = p_tenant AND lower(u.email) = lower(i.email))
      AND NOT EXISTS (SELECT 1 FROM active_emp a WHERE a.email = lower(i.email))
  )
  SELECT
    (SELECT count(*) FROM with_login)::integer,
    (SELECT count(*) FROM active_emp a WHERE a.id NOT IN (SELECT id FROM with_login))::integer,
    ((SELECT count(*) FROM mem WHERE user_id NOT IN (SELECT user_id FROM active_emp WHERE user_id IS NOT NULL))
      + (SELECT count(*) FROM open_inv))::integer,
    (SELECT count(*) FROM open_inv)::integer
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_billing_counts(text) FROM PUBLIC;
