CREATE TABLE IF NOT EXISTS "distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"title_bm" text,
	"approval_status" text DEFAULT 'Draft' NOT NULL,
	"approver" text,
	"created_by" text NOT NULL,
	"run_id" text NOT NULL,
	"compliance_check" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target_entity" text NOT NULL,
	"target_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"tool" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"output_json" jsonb,
	"error_message" text,
	"skip_reason" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"author_step" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributions_run_created_idx" ON "distributions" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributions_run_channel_idx" ON "distributions" USING btree ("run_id","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "distributions_target_idx" ON "distributions" USING btree ("target_id");