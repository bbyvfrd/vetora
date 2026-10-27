CREATE TABLE "clinical_observation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"location_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"kind" text NOT NULL,
	"value" numeric(10,3) NOT NULL,
	"unit" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"measured_by" uuid NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "clinical_observation_kind_check" CHECK ("kind" in ('weight', 'temperature', 'pulse', 'respiratory_rate', 'body_condition', 'other')),
	CONSTRAINT "clinical_observation_unit_check" CHECK (case "kind" when 'weight' then "unit" = 'kg' when 'temperature' then "unit" = '°C' when 'pulse' then "unit" = '/min' when 'respiratory_rate' then "unit" = '/min' else "unit" ~ '\S' end),
	CONSTRAINT "clinical_observation_occurred_at_check" CHECK ("occurred_at" <= now())
);
--> statement-breakpoint
CREATE INDEX "clinical_observation_patient_kind_idx" ON "clinical_observation" ("patient_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "clinical_observation_encounter_idx" ON "clinical_observation" ("encounter_id");--> statement-breakpoint
CREATE INDEX "clinical_observation_location_idx" ON "clinical_observation" ("location_id");--> statement-breakpoint
CREATE INDEX "clinical_observation_measured_by_idx" ON "clinical_observation" ("measured_by");--> statement-breakpoint
CREATE UNIQUE INDEX "encounter_id_patient_idx" ON "encounter" ("id","patient_id");--> statement-breakpoint
ALTER TABLE "clinical_observation" ADD CONSTRAINT "clinical_observation_location_id_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id");--> statement-breakpoint
ALTER TABLE "clinical_observation" ADD CONSTRAINT "clinical_observation_measured_by_staff_member_id_fkey" FOREIGN KEY ("measured_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "clinical_observation" ADD CONSTRAINT "clinical_observation_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "clinical_observation" ADD CONSTRAINT "clinical_observation_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "clinical_observation" ADD CONSTRAINT "clinical_observation_encounter_patient_fkey" FOREIGN KEY ("encounter_id","patient_id") REFERENCES "encounter"("id","patient_id");--> statement-breakpoint
-- Hand written from here; drizzle-kit models tables, not cross module keys or triggers (docs/database.md,
-- "Migrations"). The Patient module's table is a plain uuid in the Clinical Record module's schema.ts, its key here
-- (src/modules/README.md); a reading with a visit is also held to that visit's patient by the composite key above.
ALTER TABLE "clinical_observation" ADD CONSTRAINT "clinical_observation_patient_id_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id");
--> statement-breakpoint
-- The two shared triggers on every new table (docs/database.md, "Tables and the registry"), or the grants pass refuses
-- the schema.
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "clinical_observation" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "clinical_observation" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
-- An event table's window (AC-13; the rules migration): occurred_at back datable within
-- practice_settings.backdate_limit_hours, beside the table's CHECK that keeps it out of the future.
CREATE TRIGGER "assert_backdate_limit" BEFORE INSERT OR UPDATE ON "clinical_observation" FOR EACH ROW EXECUTE FUNCTION "assert_backdate_limit"();
--> statement-breakpoint
-- The readings join their visit's freeze, as the visit migration promised (CR-1, AC-2): a reading on a finalised or
-- discarded visit is refused with vetora.frozen_record, and one written during Complete visit waits for its lock and is
-- refused then. A reading with no visit (feature 11) has no parent to lock.
CREATE TRIGGER "lock_parent" BEFORE INSERT OR UPDATE OR DELETE ON "clinical_observation" FOR EACH ROW EXECUTE FUNCTION "lock_parent"('encounter', 'encounter_id', 'status', 'finalised, discarded');