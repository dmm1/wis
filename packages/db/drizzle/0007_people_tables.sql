CREATE TABLE "employee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"personnel_number" text,
	"user_id" text,
	"start_date" date,
	"end_date" date,
	"custom_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_dates_check" CHECK ("employee"."end_date" IS NULL OR "employee"."start_date" IS NULL OR "employee"."end_date" >= "employee"."start_date"),
	CONSTRAINT "employee_custom_data_object" CHECK (jsonb_typeof("employee"."custom_data") = 'object'),
	CONSTRAINT "employee_custom_data_size" CHECK (octet_length("employee"."custom_data"::text) <= 16384)
);
--> statement-breakpoint
CREATE TABLE "field_definition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"label" jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"section" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_definition_type_check" CHECK ("field_definition"."type" IN ('text','number','date','boolean','select','multi_select'))
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"tenant_id" text NOT NULL,
	"day" date NOT NULL,
	"category" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "usage_snapshots_tenant_id_day_category_pk" PRIMARY KEY("tenant_id","day","category"),
	CONSTRAINT "usage_snapshots_category_check" CHECK ("usage_snapshots"."category" IN ('employee_with_login','employee_no_login','user_only'))
);
--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_tenant_id_organization_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_tenant_name_idx" ON "employee" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint
CREATE INDEX "employee_custom_data_gin" ON "employee" USING gin ("custom_data" jsonb_path_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "employee_tenant_personnel_number_uniq" ON "employee" USING btree ("tenant_id","personnel_number") WHERE "employee"."personnel_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_tenant_user_uniq" ON "employee" USING btree ("tenant_id","user_id") WHERE "employee"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "field_definition_tenant_entity_key_uniq" ON "field_definition" USING btree ("tenant_id","entity","key");--> statement-breakpoint
CREATE INDEX "field_definition_tenant_entity_idx" ON "field_definition" USING btree ("tenant_id","entity","sort_order");