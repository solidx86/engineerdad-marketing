ALTER TABLE "briefs" ALTER COLUMN "angle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "experiment_status" text NOT NULL;