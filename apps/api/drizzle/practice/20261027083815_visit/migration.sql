CREATE TABLE "care_relationship" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"patient_id" uuid NOT NULL,
	"veterinarian_id" uuid NOT NULL,
	"established_at" timestamp with time zone NOT NULL,
	"established_by_encounter_id" uuid,
	"lapses_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "care_relationship_lapses_check" CHECK ("lapses_at" > "established_at"),
	CONSTRAINT "care_relationship_ended_check" CHECK (("ended_at" is null) = ("ended_by" is null))
);
--> statement-breakpoint
CREATE TABLE "encounter" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"location_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"veterinarian_id" uuid NOT NULL,
	"care_relationship_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"reason_for_visit" text,
	"anamnesis" text,
	"reported_by_client_id" uuid,
	"examination" text,
	"diagnosis_text" text,
	"treatment" text,
	"recommendations" text,
	"finalised_at" timestamp with time zone,
	"finalised_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "encounter_status_check" CHECK ("status" in ('draft', 'finalised', 'discarded')),
	CONSTRAINT "encounter_finalised_check" CHECK (("status" = 'finalised') = ("finalised_at" is not null) and ("finalised_at" is null) = ("finalised_by" is null)),
	CONSTRAINT "encounter_ended_check" CHECK ("ended_at" is null or "ended_at" >= "started_at"),
	CONSTRAINT "encounter_reporter_check" CHECK ("reported_by_client_id" is not null or not (coalesce("reason_for_visit", '') ~ '\S' or coalesce("anamnesis", '') ~ '\S'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "care_relationship_open_idx" ON "care_relationship" ("patient_id","veterinarian_id") WHERE "ended_at" is null;--> statement-breakpoint
CREATE INDEX "care_relationship_patient_idx" ON "care_relationship" ("patient_id");--> statement-breakpoint
CREATE INDEX "care_relationship_veterinarian_idx" ON "care_relationship" ("veterinarian_id");--> statement-breakpoint
CREATE INDEX "care_relationship_encounter_idx" ON "care_relationship" ("established_by_encounter_id");--> statement-breakpoint
CREATE INDEX "care_relationship_ended_by_idx" ON "care_relationship" ("ended_by");--> statement-breakpoint
CREATE INDEX "encounter_location_started_idx" ON "encounter" ("location_id","started_at");--> statement-breakpoint
CREATE INDEX "encounter_patient_idx" ON "encounter" ("patient_id");--> statement-breakpoint
CREATE INDEX "encounter_client_idx" ON "encounter" ("client_id");--> statement-breakpoint
CREATE INDEX "encounter_veterinarian_idx" ON "encounter" ("veterinarian_id");--> statement-breakpoint
CREATE INDEX "encounter_care_relationship_idx" ON "encounter" ("care_relationship_id");--> statement-breakpoint
CREATE INDEX "encounter_reported_by_idx" ON "encounter" ("reported_by_client_id");--> statement-breakpoint
CREATE INDEX "encounter_finalised_by_idx" ON "encounter" ("finalised_by");--> statement-breakpoint
ALTER TABLE "care_relationship" ADD CONSTRAINT "care_relationship_veterinarian_id_staff_member_id_fkey" FOREIGN KEY ("veterinarian_id") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "care_relationship" ADD CONSTRAINT "care_relationship_established_by_encounter_id_encounter_id_fkey" FOREIGN KEY ("established_by_encounter_id") REFERENCES "encounter"("id");--> statement-breakpoint
ALTER TABLE "care_relationship" ADD CONSTRAINT "care_relationship_ended_by_staff_member_id_fkey" FOREIGN KEY ("ended_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "care_relationship" ADD CONSTRAINT "care_relationship_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "care_relationship" ADD CONSTRAINT "care_relationship_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_location_id_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id");--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_veterinarian_id_staff_member_id_fkey" FOREIGN KEY ("veterinarian_id") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_care_relationship_id_care_relationship_id_fkey" FOREIGN KEY ("care_relationship_id") REFERENCES "care_relationship"("id");--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_finalised_by_staff_member_id_fkey" FOREIGN KEY ("finalised_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
-- Hand written from here; drizzle-kit models tables, not cross module keys or triggers (docs/database.md,
-- "Migrations"). The Patient and Client modules' tables are plain uuids in the Clinical Record module's schema.ts, their
-- keys here (src/modules/README.md).
ALTER TABLE "care_relationship" ADD CONSTRAINT "care_relationship_patient_id_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id");
--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_patient_id_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id");
--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id");
--> statement-breakpoint
ALTER TABLE "encounter" ADD CONSTRAINT "encounter_reported_by_client_id_client_id_fkey" FOREIGN KEY ("reported_by_client_id") REFERENCES "client"("id");
--> statement-breakpoint
-- The two shared triggers on every new table (docs/database.md, "Tables and the registry"), or the grants pass refuses
-- the schema.
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "care_relationship" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "care_relationship" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "encounter" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "encounter" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
-- The set once class learns its one exception (spec 0002, "Key invariants": `lapses_at` only later): an argument
-- `later:<col>` names an instant that may only move later, never back and never to null, which a finalised visit does
-- to its care relationship. Every other argument means what it meant (the rules migration): a named column goes from
-- null to a value once, any other column is frozen unless the first argument is 'only'. vetora.set_once (VT002) for
-- every refusal; the function keeps its owner, its search_path and its revoked EXECUTE.
CREATE OR REPLACE FUNCTION "set_once"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  others_frozen boolean := coalesce(TG_ARGV[0] <> 'only', true);
  args text[] := CASE WHEN TG_ARGV[0] = 'only' THEN TG_ARGV[1:TG_NARGS - 1] ELSE TG_ARGV[0:TG_NARGS - 1] END;
  named text[] := ARRAY(SELECT arg FROM unnest(args) AS arg WHERE arg NOT LIKE 'later:%');
  later text[] := ARRAY(SELECT substr(arg, 7) FROM unnest(args) AS arg WHERE arg LIKE 'later:%');
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  col text;
  changed record;
BEGIN
  IF cardinality(named) + cardinality(later) = 0 THEN
    RAISE EXCEPTION 'set_once on %.% names no column', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  FOREACH col IN ARRAY named || later LOOP
    IF NOT new_row ? col THEN
      RAISE EXCEPTION 'set_once on %.% names a column the table does not have: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, col;
    END IF;
  END LOOP;
  FOR changed IN
    SELECT n.key, o.value AS old_value, n.value AS new_value
    FROM jsonb_each(new_row) AS n JOIN jsonb_each(old_row) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value AND n.key NOT IN ('updated_at', 'updated_by', 'version')
    ORDER BY n.key
  LOOP
    IF changed.key = ANY (later) THEN
      IF changed.new_value = 'null'::jsonb
        OR (changed.new_value #>> '{}')::timestamptz <= (changed.old_value #>> '{}')::timestamptz THEN
        RAISE EXCEPTION USING
          MESSAGE = format('vetora.set_once: %s.%s may only move later', TG_TABLE_NAME, changed.key),
          ERRCODE = 'VT002';
      END IF;
    ELSIF changed.key = ANY (named) THEN
      -- A null going to a value is the one allowed change; the value never moves again, not even back to null.
      IF changed.old_value <> 'null'::jsonb THEN
        RAISE EXCEPTION USING
          MESSAGE = format('vetora.set_once: %s.%s is set once and already set', TG_TABLE_NAME, changed.key),
          ERRCODE = 'VT002';
      END IF;
    ELSIF others_frozen THEN
      RAISE EXCEPTION USING
        MESSAGE = format('vetora.set_once: %s.%s is not a set once column and cannot change', TG_TABLE_NAME, changed.key),
        ERRCODE = 'VT002';
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint
-- The set once class (table-classes.ts): a care relationship ends by filling ended_at and ended_by once, and each
-- finalised visit moves lapses_at later (CR-4).
CREATE TRIGGER "set_once" BEFORE UPDATE ON "care_relationship" FOR EACH ROW EXECUTE FUNCTION "set_once"('ended_at', 'ended_by', 'later:lapses_at');
--> statement-breakpoint
-- The frozen by status class (table-classes.ts): once finalised or discarded, nothing of a visit changes (CR-1, AC-2);
-- a correction is an encounter_amendment (feature 12). Its observations join the freeze with lock_parent() in #23.
CREATE TRIGGER "freeze_record" BEFORE UPDATE OR DELETE ON "encounter" FOR EACH ROW EXECUTE FUNCTION "freeze_record"('status', 'finalised, discarded', '');
--> statement-breakpoint
-- The finalise trigger (spec 0002, "Data model sketch": encounter; "Key invariants"), BEFORE INSERT OR UPDATE on
-- encounter, on the move from draft to finalised (or a row inserted finalised): the finaliser is the transaction's actor
-- and an active staff member holding the veterinarian role, read from staff_member.roles (CR-2, vetora.not_veterinarian
-- VT006); the reason for visit holds text (vetora.reason_for_visit_required VT008) and names who told it (CR-5,
-- vetora.reporter_required VT009); and care_relationship_id is the patient's relationship, open and established by
-- finalised_at and lapsing after it, with that veterinarian or, while practice_settings.delegation_enabled, any
-- veterinarian of the practice (CR-4, AC-14, vetora.no_care_relationship VT007), read FOR SHARE so it cannot end
-- beside the finalise. The handler creates or extends that relationship in the same transaction. A row already final
-- is left to freeze_record(), which fires after this one (BEFORE triggers fire in name order). A migrator session,
-- which has no actor, skips the actor comparison and nothing else.
CREATE FUNCTION "finalise_encounter"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  actor uuid;
  finaliser_roles text[];
  finaliser_active boolean;
  delegation boolean;
  rel_patient uuid;
  rel_vet uuid;
  rel_vet_roles text[];
  rel_established timestamptz;
  rel_lapses timestamptz;
  rel_ended timestamptz;
BEGIN
  IF NEW.status <> 'finalised' OR (TG_OP = 'UPDATE' AND OLD.status <> 'draft') THEN
    RETURN NEW;
  END IF;
  EXECUTE format('select %I.current_actor()', TG_TABLE_SCHEMA) INTO actor;
  EXECUTE format('select roles, active from %I.staff_member where id = $1', TG_TABLE_SCHEMA)
    INTO finaliser_roles, finaliser_active USING NEW.finalised_by;
  IF (actor IS NOT NULL AND NEW.finalised_by IS DISTINCT FROM actor)
    OR NOT coalesce('veterinarian' = ANY (finaliser_roles) AND finaliser_active, false) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'vetora.not_veterinarian: encounter.finalised_by is not the acting veterinarian',
      ERRCODE = 'VT006';
  END IF;
  IF NOT coalesce(NEW.reason_for_visit ~ '\S', false) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'vetora.reason_for_visit_required: encounter.reason_for_visit is blank',
      ERRCODE = 'VT008';
  END IF;
  IF NEW.reported_by_client_id IS NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'vetora.reporter_required: encounter.reported_by_client_id is not set',
      ERRCODE = 'VT009';
  END IF;
  EXECUTE format('select delegation_enabled from %I.practice_settings', TG_TABLE_SCHEMA) INTO delegation;
  EXECUTE format(
    'select c.patient_id, c.veterinarian_id, s.roles, c.established_at, c.lapses_at, c.ended_at
     from %1$I.care_relationship c join %1$I.staff_member s on s.id = c.veterinarian_id
     where c.id = $1 for share of c',
    TG_TABLE_SCHEMA
  ) INTO rel_patient, rel_vet, rel_vet_roles, rel_established, rel_lapses, rel_ended USING NEW.care_relationship_id;
  IF rel_patient IS DISTINCT FROM NEW.patient_id
    OR rel_ended IS NOT NULL
    OR rel_established > NEW.finalised_at
    OR rel_lapses <= NEW.finalised_at
    OR NOT (rel_vet = NEW.finalised_by OR (coalesce(delegation, false) AND 'veterinarian' = ANY (rel_vet_roles))) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'vetora.no_care_relationship: encounter.care_relationship_id is not current for the patient and veterinarian',
      ERRCODE = 'VT007';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "finalise_encounter"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "finalise_encounter" BEFORE INSERT OR UPDATE ON "encounter" FOR EACH ROW EXECUTE FUNCTION "finalise_encounter"();
