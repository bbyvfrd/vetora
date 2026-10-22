-- IF NOT EXISTS: the migrate command creates "control" for its migrations table before this batch runs (spec 0001, "Migrations").
CREATE SCHEMA IF NOT EXISTS "control";
--> statement-breakpoint
CREATE TABLE "control"."practice" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"schema_name" text NOT NULL UNIQUE,
	"role_name" text NOT NULL UNIQUE,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_status_check" CHECK ("status" in ('provisioning', 'active', 'suspended', 'archived'))
);
--> statement-breakpoint
-- Hand written from here; drizzle-kit models tables, not extensions, functions, or grants (spec 0002, "Interface surface").
-- Everything runs as vetora_migrator, which owns every object (spec 0002, "Security model").
-- The ext schema holds the extensions once for every practice (spec 0002, "Conventions": Schemas); all three are
-- trusted extensions, so the migrator installs them without superuser rights.
CREATE SCHEMA "ext";
--> statement-breakpoint
CREATE EXTENSION "btree_gist" WITH SCHEMA "ext";
--> statement-breakpoint
CREATE EXTENSION "pg_trgm" WITH SCHEMA "ext";
--> statement-breakpoint
CREATE EXTENSION "unaccent" WITH SCHEMA "ext";
--> statement-breakpoint
-- unaccent() is STABLE (its dictionary can change), so it cannot sit in an index expression; this wrapper pins the
-- dictionary and is IMMUTABLE, the form spec 0001 names for the search indexes of slice 6 (spec 0001, "Search").
CREATE FUNCTION "ext"."unaccent_immutable"(input text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = pg_catalog
  RETURN "ext"."unaccent"('ext.unaccent'::pg_catalog.regdictionary, input);
--> statement-breakpoint
-- Least privilege (spec 0002, "Security model"): the app reads the registry to route a request and nothing else;
-- the backup role reads everything for dumps, the migrations table Drizzle created before this batch included;
-- every write, DELETE included, stays with the owner.
GRANT USAGE ON SCHEMA "control" TO vetora_app, vetora_backup;
--> statement-breakpoint
GRANT SELECT ON TABLE "control"."practice" TO vetora_app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "control" TO vetora_backup;
--> statement-breakpoint
GRANT SELECT ON ALL SEQUENCES IN SCHEMA "control" TO vetora_backup;
