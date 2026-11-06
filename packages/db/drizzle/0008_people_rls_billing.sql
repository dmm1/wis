-- ---------------------------------------------------------------------------
-- Row level security: employees and field definitions are tenant data.
-- wis_app may read, create and update (never delete: ending employment sets end_date,
-- definitions are archived; erasure is a deliberate platform operation).
-- ---------------------------------------------------------------------------
ALTER TABLE "employee" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employee" FOR ALL TO wis_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "employee" TO wis_app;
--> statement-breakpoint
ALTER TABLE "field_definition" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "field_definition" FOR ALL TO wis_app
  USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "field_definition" TO wis_app;
--> statement-breakpoint
-- Usage snapshots belong to the platform: RLS on, no policy, no grant.
ALTER TABLE "usage_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Billable headcount: every active person is counted once, in exactly one category
-- (architecture 4.3).
--   employee_with_login: active employee linked to a user who is a member of the tenant
--   employee_no_login:   other active employees
--   user_only:           members without an active linked employee, plus open invitations
--                        (a reserved seat) unless that person is already counted:
--                        invitation e-mail matches an existing member or an active employee.
-- "Active" employee: start_date <= today (or empty) and end_date >= today (or empty).
-- SECURITY DEFINER: tenant code (wis_app) has no access to member/invitation/user, but its
-- inserts must still be checked against the seat limit.
-- ---------------------------------------------------------------------------
CREATE FUNCTION tenant_billing_counts(p_tenant text)
RETURNS TABLE (employee_with_login integer, employee_no_login integer, user_only integer)
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
      + (SELECT count(*) FROM open_inv))::integer
$$;
--> statement-breakpoint
-- Billable people for the tenant's billing preset (default: per user).
CREATE FUNCTION tenant_billable_count(p_tenant text) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT CASE coalesce((SELECT billing->>'preset' FROM tenant_entitlements WHERE tenant_id = p_tenant), 'per_user')
           WHEN 'per_employee' THEN c.employee_with_login + c.employee_no_login
           WHEN 'both'         THEN c.employee_with_login + c.employee_no_login + c.user_only
           ELSE                     c.employee_with_login + c.user_only
         END
  FROM tenant_billing_counts(p_tenant) c
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION tenant_billing_counts(text), tenant_billable_count(text) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seat limit: replaces the earlier BEFORE triggers. Runs AFTER the change, so the new row is part
-- of the count; raising rolls the statement back. The tenant's entitlement row is locked first, so
-- concurrent changes serialise per tenant (each sees the other's committed rows).
-- Codes: WS001 SEAT_LIMIT_REACHED, WS002 TENANT_NOT_PROVISIONED, WS004 TENANT_NOT_ACTIVE.
-- ---------------------------------------------------------------------------
DROP TRIGGER member_seat_limit ON "member";
--> statement-breakpoint
DROP TRIGGER invitation_seat_limit ON "invitation";
--> statement-breakpoint
DROP FUNCTION enforce_seat_limit();
--> statement-breakpoint
CREATE FUNCTION enforce_seat_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant text;
  v_max integer;
  v_status tenant_status;
BEGIN
  v_tenant := CASE TG_TABLE_NAME WHEN 'employee' THEN NEW.tenant_id ELSE NEW.organization_id END;

  SELECT max_seats, status INTO v_max, v_status
    FROM tenant_entitlements WHERE tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_PROVISIONED' USING ERRCODE = 'WS002';
  END IF;
  IF v_status IN ('suspended', 'offboarding') THEN
    RAISE EXCEPTION 'TENANT_NOT_ACTIVE' USING ERRCODE = 'WS004';
  END IF;
  IF tenant_billable_count(v_tenant) > v_max THEN
    RAISE EXCEPTION 'SEAT_LIMIT_REACHED' USING ERRCODE = 'WS001';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER member_seat_limit AFTER INSERT ON "member"
  FOR EACH ROW EXECUTE FUNCTION enforce_seat_limit();
--> statement-breakpoint
CREATE TRIGGER invitation_seat_limit AFTER INSERT ON "invitation"
  FOR EACH ROW EXECUTE FUNCTION enforce_seat_limit();
--> statement-breakpoint
CREATE TRIGGER employee_seat_limit AFTER INSERT OR UPDATE OF user_id, start_date, end_date ON "employee"
  FOR EACH ROW EXECUTE FUNCTION enforce_seat_limit();
