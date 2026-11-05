-- Bootstrap for row-level-security based multi-tenancy.
--
-- Runtime queries run as `wis_app` (via SET LOCAL ROLE in withTenant()). The
-- connection user (table owner) has BYPASSRLS on Neon, so without switching
-- role the policies would never apply.
--
-- Convention: NO default privileges. Every migration that creates a tenant
-- table must explicitly GRANT to wis_app and ENABLE ROW LEVEL SECURITY with a
-- policy on app_tenant_id(). Tables that must not be reachable by tenant code
-- (e.g. auth internals) simply receive no grant.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wis_app') THEN
    CREATE ROLE wis_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
-- Allow the connecting (owner) user to SET ROLE wis_app.
GRANT wis_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO wis_app;
--> statement-breakpoint
-- Current tenant for this transaction; NULL when unset so policies fail closed.
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '') $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_tenant_id() TO wis_app;
