CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" text DEFAULT 'person' NOT NULL,
	"first_name" text,
	"last_name" text,
	"patronymic" text,
	"organisation_name" text,
	"tax_id" text,
	"contact_person" text,
	"address" text,
	"preferred_language" lang_code NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_kind_check" CHECK ("kind" in ('person', 'organisation')),
	CONSTRAINT "client_status_check" CHECK ("status" in ('active', 'archived')),
	CONSTRAINT "client_name_check" CHECK (("kind" = 'person' and "last_name" is not null) or ("kind" = 'organisation' and "organisation_name" is not null))
);
--> statement-breakpoint
CREATE TABLE "client_contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"value_normalised" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"messaging_allowed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "client_contact_kind_check" CHECK ("kind" in ('phone', 'whatsapp', 'telegram', 'email'))
);
--> statement-breakpoint
CREATE TABLE "breed" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"species_id" uuid NOT NULL,
	"name_az" text,
	"name_ru" text,
	"name_en" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "breed_name_check" CHECK (coalesce("name_az", "name_ru", "name_en") is not null)
);
--> statement-breakpoint
CREATE TABLE "ownership" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"patient_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ownership_role_check" CHECK ("role" in ('owner', 'authorised_person')),
	CONSTRAINT "ownership_period_check" CHECK ("valid_to" is null or "valid_to" > "valid_from")
);
--> statement-breakpoint
CREATE TABLE "patient" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"species_id" uuid NOT NULL,
	"breed_id" uuid,
	"sex" text NOT NULL,
	"is_neutered" boolean DEFAULT false NOT NULL,
	"neutered_on" date,
	"birth_date" date,
	"birth_date_is_estimate" boolean DEFAULT false NOT NULL,
	"colour" text,
	"markings" text,
	"microchip_number" text,
	"passport_number" text,
	"life_status" text DEFAULT 'alive' NOT NULL,
	"deceased_on" date,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "patient_sex_check" CHECK ("sex" in ('male', 'female', 'unknown')),
	CONSTRAINT "patient_life_status_check" CHECK ("life_status" in ('alive', 'deceased')),
	CONSTRAINT "patient_status_check" CHECK ("status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "species" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"code" text NOT NULL UNIQUE,
	"name_az" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_en" text NOT NULL,
	"clinically_supported" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "client_contact_client_idx" ON "client_contact" ("client_id");--> statement-breakpoint
CREATE INDEX "client_contact_value_normalised_idx" ON "client_contact" ("value_normalised");--> statement-breakpoint
CREATE UNIQUE INDEX "client_contact_primary_idx" ON "client_contact" ("client_id") WHERE "is_primary";--> statement-breakpoint
CREATE INDEX "breed_species_idx" ON "breed" ("species_id");--> statement-breakpoint
CREATE UNIQUE INDEX "breed_species_name_ru_idx" ON "breed" ("species_id","name_ru") WHERE "name_ru" is not null;--> statement-breakpoint
CREATE INDEX "ownership_patient_idx" ON "ownership" ("patient_id");--> statement-breakpoint
CREATE INDEX "ownership_client_idx" ON "ownership" ("client_id");--> statement-breakpoint
CREATE INDEX "patient_species_idx" ON "patient" ("species_id");--> statement-breakpoint
CREATE INDEX "patient_breed_idx" ON "patient" ("breed_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_microchip_number_idx" ON "patient" ("microchip_number") WHERE "microchip_number" is not null;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "client_contact" ADD CONSTRAINT "client_contact_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id");--> statement-breakpoint
ALTER TABLE "client_contact" ADD CONSTRAINT "client_contact_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "client_contact" ADD CONSTRAINT "client_contact_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "breed" ADD CONSTRAINT "breed_species_id_species_id_fkey" FOREIGN KEY ("species_id") REFERENCES "species"("id");--> statement-breakpoint
ALTER TABLE "breed" ADD CONSTRAINT "breed_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "breed" ADD CONSTRAINT "breed_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "ownership" ADD CONSTRAINT "ownership_patient_id_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id");--> statement-breakpoint
ALTER TABLE "ownership" ADD CONSTRAINT "ownership_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "ownership" ADD CONSTRAINT "ownership_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_species_id_species_id_fkey" FOREIGN KEY ("species_id") REFERENCES "species"("id");--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_breed_id_breed_id_fkey" FOREIGN KEY ("breed_id") REFERENCES "breed"("id");--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "patient" ADD CONSTRAINT "patient_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "species" ADD CONSTRAINT "species_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
-- Hand written from here; drizzle-kit models tables, not exclusion constraints, collations, cross module keys or
-- triggers (docs/database.md, "Migrations").
-- ownership.client_id names the Client module's table: a plain uuid in the Patient module's schema.ts, the key here
-- (src/modules/README.md).
ALTER TABLE "ownership" ADD CONSTRAINT "ownership_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id");
--> statement-breakpoint
-- AC-5, PT-1: one current owner per patient. Two owner periods of one patient may not overlap; a null valid_to is open
-- ended and the range is half open, so a period closed on a day and the next opened on that day both stand. An
-- authorised person is not an owner and may overlap anyone. btree_gist (in ext, on the migration's search_path)
-- gives the uuid equality its gist operator class.
ALTER TABLE "ownership" ADD CONSTRAINT "ownership_one_owner" EXCLUDE USING gist ("patient_id" WITH =, daterange("valid_from", "valid_to") WITH &&) WHERE ("role" = 'owner');
--> statement-breakpoint
-- Catalog names sort by their language's ICU collation (spec 0002, "Conventions": Languages).
ALTER TABLE "species" ALTER COLUMN "name_az" TYPE text COLLATE "az-x-icu", ALTER COLUMN "name_ru" TYPE text COLLATE "ru-x-icu", ALTER COLUMN "name_en" TYPE text COLLATE "en-x-icu";
--> statement-breakpoint
ALTER TABLE "breed" ALTER COLUMN "name_az" TYPE text COLLATE "az-x-icu", ALTER COLUMN "name_ru" TYPE text COLLATE "ru-x-icu", ALTER COLUMN "name_en" TYPE text COLLATE "en-x-icu";
--> statement-breakpoint
-- The two shared triggers on every new table (docs/database.md, "Tables and the registry"), or the grants pass refuses
-- the schema.
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "client" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "client" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "client_contact" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "client_contact" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "species" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "species" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "breed" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "breed" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "patient" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "patient" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "ownership" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "ownership" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
-- The set once class (table-classes.ts): an ownership period ends by filling valid_to once, nothing else changes.
CREATE TRIGGER "set_once" BEFORE UPDATE ON "ownership" FOR EACH ROW EXECUTE FUNCTION "set_once"('valid_to');