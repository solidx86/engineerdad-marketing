CREATE SCHEMA "analytics";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics"."angle_tags" (
	"ad_id" text NOT NULL,
	"tag_kind" text NOT NULL,
	"tag_value" text NOT NULL,
	CONSTRAINT "angle_tags_ad_id_tag_kind_tag_value_pk" PRIMARY KEY("ad_id","tag_kind","tag_value")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics"."creative_signals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"channel" text NOT NULL,
	"platform" text,
	"kpi_name" text NOT NULL,
	"kpi_value" real NOT NULL,
	"ts" bigint NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics"."creatives" (
	"ad_id" text PRIMARY KEY NOT NULL,
	"name" text,
	"hook" text,
	"angle" text,
	"persona" text,
	"format" text,
	"language" text,
	"brief_page_id" text,
	"variant_page_id" text,
	"launched_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics"."events" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL,
	"event_name" text NOT NULL,
	"source" text,
	"payload_json" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics"."meta_insights" (
	"date" text NOT NULL,
	"ad_id" text NOT NULL,
	"adset_id" text,
	"campaign_id" text,
	"spend" real,
	"impressions" integer,
	"clicks" integer,
	"ctr" real,
	"cpm" real,
	"leads" integer,
	"purchases" integer,
	"value" real,
	"avg_watch_sec" real,
	"raw_json" jsonb,
	CONSTRAINT "meta_insights_date_ad_id_pk" PRIMARY KEY("date","ad_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "angle_tags_kind_idx" ON "analytics"."angle_tags" USING btree ("tag_kind","tag_value");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "creative_signals_dedup_idx" ON "analytics"."creative_signals" USING btree ("variant_id","channel","platform","kpi_name","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_signals_variant_idx" ON "analytics"."creative_signals" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "creative_signals_channel_ts_idx" ON "analytics"."creative_signals" USING btree ("channel","ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_ts_idx" ON "analytics"."events" USING btree ("ts");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_name_idx" ON "analytics"."events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_insights_ad_idx" ON "analytics"."meta_insights" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meta_insights_date_idx" ON "analytics"."meta_insights" USING btree ("date");