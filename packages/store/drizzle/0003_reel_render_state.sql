ALTER TABLE "creative_variants" ADD COLUMN "render_state" text;--> statement-breakpoint
ALTER TABLE "creative_variants" ADD COLUMN "render_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creative_variants" DROP COLUMN IF EXISTS "reel_mp4_url";