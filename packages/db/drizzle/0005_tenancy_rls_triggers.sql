-- Locale is constrained to the supported UI/e-mail languages.
ALTER TABLE "user" ADD CONSTRAINT "user_locale_check" CHECK ("locale" IN ('en', 'de'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tenant-readable, platform-writable tables: tenants see only their own rows.
-- ---------------------------------------------------------------------------
ALTER TABLE "tenant_entitlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_read_own" ON "tenant_entitlements" FOR SELECT TO wis_app
  USING (tenant_id = app_tenant_id());
--> statement-breakpoint
GRANT SELECT ON "tenant_entitlements" TO wis_app;
--> statement-breakpoint
ALTER TABLE "tenant_modules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_read_own" ON "tenant_modules" FOR SELECT TO wis_app
  USING (tenant_id = app_tenant_id());
--> statement-breakpoint
GRANT SELECT ON "tenant_modules" TO wis_app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit log: tenants may append and read their own rows; nobody updates/deletes.
-- Platform rows (tenant_id IS NULL) are written on the owner connection.
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_read_own" ON "audit_log" FOR SELECT TO wis_app
  USING (tenant_id = app_tenant_id());
--> statement-breakpoint
CREATE POLICY "tenant_append_own" ON "audit_log" FOR INSERT TO wis_app
  WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_log" TO wis_app;
--> statement-breakpoint
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only the retention job may delete, by setting wis.audit_purge (wis_app has no DELETE grant anyway).
  IF TG_OP = 'DELETE' AND current_setting('wis.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE' USING ERRCODE = 'WS003';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Seat limit + tenant status, enforced race-free in the database.
-- The entitlements row is locked FOR UPDATE, so concurrent inserts serialise per tenant.
-- Today a seat = a member (login). Pending invitations reserve a seat. When employees
-- exist (step 4) this counts billable people per the tenant's billing config.
-- Error codes: WS001 SEAT_LIMIT_REACHED, WS002 TENANT_NOT_PROVISIONED, WS004 TENANT_NOT_ACTIVE.
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_seat_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_max integer;
  v_status tenant_status;
  v_members integer;
  v_pending integer := 0;
BEGIN
  SELECT max_seats, status INTO v_max, v_status
    FROM tenant_entitlements WHERE tenant_id = NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_PROVISIONED' USING ERRCODE = 'WS002';
  END IF;
  IF v_status IN ('suspended', 'offboarding') THEN
    RAISE EXCEPTION 'TENANT_NOT_ACTIVE' USING ERRCODE = 'WS004';
  END IF;

  SELECT count(*) INTO v_members FROM "member" WHERE organization_id = NEW.organization_id;
  IF TG_TABLE_NAME = 'invitation' THEN
    SELECT count(*) INTO v_pending FROM "invitation"
      WHERE organization_id = NEW.organization_id AND status = 'pending' AND expires_at > now();
  END IF;

  IF v_members + v_pending >= v_max THEN
    RAISE EXCEPTION 'SEAT_LIMIT_REACHED' USING ERRCODE = 'WS001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER member_seat_limit BEFORE INSERT ON "member"
  FOR EACH ROW EXECUTE FUNCTION enforce_seat_limit();
--> statement-breakpoint
CREATE TRIGGER invitation_seat_limit BEFORE INSERT ON "invitation"
  FOR EACH ROW EXECUTE FUNCTION enforce_seat_limit();
