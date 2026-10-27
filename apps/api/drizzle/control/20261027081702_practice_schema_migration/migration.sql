-- How far a practice's schema has migrated (#21; spec 0001, "Migrations": Drizzle's migration table in each schema is
-- the truth, and the app refuses to serve a practice whose schema is behind). The request context reads it beside the
-- registry row, before any transaction in the practice: vetora_app holds no grant on a practice schema, and the
-- migrations table is granted to no practice role (table-classes.ts), so this owner run function reads it. The newest
-- migration name recorded, which sorts by its timestamp (ADR 0002), or null when the schema has none yet. It takes a
-- registry id, never a schema name, so it reads no schema outside the registry.
CREATE FUNCTION "control"."practice_schema_migration"(practice_id uuid) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  target text;
  newest text;
BEGIN
  SELECT schema_name INTO target FROM control.practice WHERE id = practice_id;
  IF target IS NULL OR to_regclass(format('%I.__drizzle_migrations', target)) IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('select max(name) from %I.__drizzle_migrations', target) INTO newest;
  RETURN newest;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "control"."practice_schema_migration"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "control"."practice_schema_migration"(uuid) TO vetora_app;
