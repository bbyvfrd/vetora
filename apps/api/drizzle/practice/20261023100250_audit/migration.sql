CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed" jsonb NOT NULL,
	"request_id" text,
	CONSTRAINT "audit_event_action_check" CHECK ("action" in ('insert', 'update', 'delete')),
	CONSTRAINT "audit_event_source_check" CHECK ("source" = 'request' or "source" like 'migration:%'),
	CONSTRAINT "audit_event_actor_check" CHECK ("actor_id" is not null or "source" like 'migration:%')
);
--> statement-breakpoint
CREATE TABLE "staff_member" (
	"id" uuid PRIMARY KEY,
	"display_name" text NOT NULL,
	"roles" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "staff_member_roles_check" CHECK (cardinality("roles") > 0 and "roles" <@ '{manager,veterinarian,assistant,receptionist,groomer}'::text[])
);
--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_settings" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_settings" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "practice_settings" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_settings" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "practice_settings" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_event_row_idx" ON "audit_event" ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" ("actor_id","occurred_at");--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_staff_member_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "practice_settings" ADD CONSTRAINT "practice_settings_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "practice_settings" ADD CONSTRAINT "practice_settings_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "staff_member" ADD CONSTRAINT "staff_member_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
-- Hand written from here; drizzle-kit models tables, not functions or triggers (spec 0002, "Interface surface").
-- Three owner run functions (spec 0002, "Security model": Owner run functions), one copy per practice schema like
-- every object of the set: SECURITY DEFINER, so they run as vetora_migrator, who owns audit_event, with search_path
-- pinned to pg_catalog and the practice schema addressed through TG_TABLE_SCHEMA, so a practice role can neither forge
-- an audit row nor redirect a name. Handlers write every business row in plain sight; these only stamp and log.
-- IN-1: the acting staff member of the transaction, from app.actor_id (spec 0002, "Conventions": Actor). A transaction
-- without one is refused with vetora.no_actor, SQLSTATE VT001 (the rule error convention, src/platform/db/errors.ts).
-- A vetora_migrator session may write without an actor (a migration, an import revert), which audit_row() records as
-- such; session_user stays the login role inside a SECURITY DEFINER function, where current_user is the owner.
CREATE FUNCTION "current_actor"() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  actor text := nullif(current_setting('app.actor_id', true), '');
BEGIN
  IF actor IS NULL THEN
    IF session_user = 'vetora_migrator' THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'vetora.no_actor: app.actor_id is not set for this transaction', ERRCODE = 'VT001';
  END IF;
  RETURN actor::uuid;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "current_actor"() FROM PUBLIC;
--> statement-breakpoint
-- The standard columns (spec 0002, "Conventions": Standard columns), BEFORE INSERT OR UPDATE on every practice table:
-- the database clock and the actor of the transaction, never the values the client sent; an update keeps created_at
-- and created_by as they were and bumps version by one (optimistic concurrency), so no handler can forget it.
CREATE FUNCTION "set_updated_at"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  actor uuid;
BEGIN
  EXECUTE format('select %I.current_actor()', TG_TABLE_SCHEMA) INTO actor;
  NEW.updated_at := now();
  NEW.updated_by := actor;
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.created_by := actor;
    NEW.version := 1;
  ELSE
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "set_updated_at"() FROM PUBLIC;
--> statement-breakpoint
-- The audit log (IN-1, AC-8), AFTER INSERT OR UPDATE OR DELETE on every practice table but audit_event itself: an
-- insert stores the row, an update the new values of the columns that changed, a delete the old row. On a
-- vetora_migrator session source is migration:<app.migration> (migrate sets the set name on its connection,
-- provision-practice its own name, a data migration its folder name at its top); the setting is ignored on any other
-- session, so a request cannot pass as a migration, and source is request. request_id is app.request_id when set.
CREATE FUNCTION "audit_row"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  actor uuid;
  migration text := CASE WHEN session_user = 'vetora_migrator' THEN nullif(current_setting('app.migration', true), '') END;
  row_id uuid;
  changed jsonb;
BEGIN
  EXECUTE format('select %I.current_actor()', TG_TABLE_SCHEMA) INTO actor;
  IF TG_OP = 'INSERT' THEN
    row_id := NEW.id;
    changed := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    row_id := NEW.id;
    SELECT coalesce(jsonb_object_agg(new_value.key, new_value.value), '{}'::jsonb) INTO changed
    FROM jsonb_each(to_jsonb(NEW)) AS new_value
    WHERE to_jsonb(OLD) -> new_value.key IS DISTINCT FROM new_value.value;
  ELSE
    row_id := OLD.id;
    changed := to_jsonb(OLD);
  END IF;
  EXECUTE format(
    'insert into %I.audit_event (table_name, row_id, action, actor_id, source, changed, request_id) values ($1, $2, $3, $4, $5, $6, $7)',
    TG_TABLE_SCHEMA
  ) USING TG_TABLE_NAME, row_id, lower(TG_OP), actor,
    CASE WHEN migration IS NULL THEN 'request' ELSE 'migration:' || migration END,
    changed, nullif(current_setting('app.request_id', true), '');
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "audit_row"() FROM PUBLIC;
--> statement-breakpoint
-- Both triggers on every practice table (spec 0002, "Security model": Audit is mandatory); audit_event has neither.
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "practice_settings" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "practice_settings" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "location" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "location" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "staff_member" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "staff_member" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
