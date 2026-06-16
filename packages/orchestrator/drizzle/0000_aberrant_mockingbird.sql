CREATE SCHEMA "orchestrator";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orchestrator"."run_steps" (
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_steps_run_id_step_id_pk" PRIMARY KEY("run_id","step_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orchestrator"."runs" (
	"id" text PRIMARY KEY NOT NULL,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"params" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orchestrator"."step_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_id" text NOT NULL,
	"unit_index" integer,
	"payload" jsonb NOT NULL,
	"payload_kind" text,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orchestrator"."run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "orchestrator"."runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "run_steps_run_idx" ON "orchestrator"."run_steps" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "step_results_run_step_idx" ON "orchestrator"."step_results" USING btree ("run_id","step_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "step_results_input_idempotency_idx" ON "orchestrator"."step_results" USING btree ("run_id","step_id","unit_index","payload_kind") WHERE "orchestrator"."step_results"."payload_kind" IS NOT NULL;