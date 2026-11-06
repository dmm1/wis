-- Fix for 0008: PL/pgSQL resolves NEW.<column> at plan time, so one trigger function cannot name
-- both employee.tenant_id and member/invitation.organization_id directly. Read the tenant from the row's
-- JSON representation instead (employee has tenant_id; member and invitation have organization_id).
CREATE OR REPLACE FUNCTION enforce_seat_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant text;
  v_max integer;
  v_status tenant_status;
BEGIN
  v_tenant := coalesce(to_jsonb(NEW)->>'tenant_id', to_jsonb(NEW)->>'organization_id');

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
