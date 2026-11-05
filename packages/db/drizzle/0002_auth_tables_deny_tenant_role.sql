-- Defence in depth: auth internals are never reachable by tenant code.
-- wis_app receives no GRANT on these tables (no default privileges), and RLS is
-- enabled without any policy so even an accidental future GRANT exposes no rows.
-- The owner connection used by the auth layer bypasses RLS.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organization_role" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "team_member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "two_factor" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "passkey" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rate_limit" ENABLE ROW LEVEL SECURITY;
