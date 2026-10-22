-- Hand written from here to the first table; drizzle-kit models tables, not domains (spec 0002, "Interface surface").
-- The practice set is applied with search_path set to the practice schema, so every unqualified name below lands
-- there: one copy of every object per practice, versioned with the set. Everything runs as vetora_migrator, which
-- owns every object; the practice role's grants are set by the grants step after the batch (src/platform/db/grants.ts).
-- IN-4: money is integer minor units beside a currency code (spec 0002, "Conventions": Money); AZN only for now. A
-- bound value with a fraction (how the API sends values) is refused; a numeric literal in SQL is rounded, as for any bigint.
CREATE DOMAIN "minor_units" AS bigint;
--> statement-breakpoint
CREATE DOMAIN "currency_code" AS text CHECK (VALUE IN ('AZN'));
--> statement-breakpoint
-- AC-13: a language is one of the three the product ships in (spec 0002, "Conventions": Languages).
CREATE DOMAIN "lang_code" AS text CHECK (VALUE IN ('az', 'ru', 'en'));
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"address" text,
	"phone" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_settings" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000000',
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"address" text,
	"phone" text,
	"tax_id" text,
	"time_zone" text DEFAULT 'Asia/Baku' NOT NULL,
	"currency" currency_code DEFAULT 'AZN' NOT NULL,
	"languages" lang_code[] DEFAULT '{az,ru}'::lang_code[] NOT NULL,
	"default_language" lang_code NOT NULL,
	"care_relationship_lapse_months" integer DEFAULT 12 NOT NULL,
	"backdate_limit_hours" integer DEFAULT 24 NOT NULL,
	"delegation_enabled" boolean DEFAULT true NOT NULL,
	"go_live_at" timestamp with time zone,
	CONSTRAINT "practice_settings_single_row" CHECK ("id" = '00000000-0000-0000-0000-000000000000')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "location_default_idx" ON "location" ("is_default") WHERE "is_default";