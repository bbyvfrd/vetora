CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"location_id" uuid NOT NULL,
	"number" text,
	"client_id" uuid,
	"patient_id" uuid,
	"encounter_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"currency" currency_code DEFAULT 'AZN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_status_check" CHECK ("status" in ('draft', 'issued', 'void', 'discarded')),
	CONSTRAINT "invoice_issued_check" CHECK (("status" in ('issued', 'void')) = ("issued_at" is not null) and ("issued_at" is null) = ("number" is null))
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"service_id" uuid,
	"description_az" text,
	"description_ru" text,
	"description_en" text,
	"quantity" numeric NOT NULL,
	"unit_price_minor" minor_units NOT NULL,
	"discount_minor" minor_units DEFAULT 0 NOT NULL,
	"discount_reason" text,
	"total_minor" minor_units NOT NULL,
	"tax_rate" numeric,
	"removed_at" timestamp with time zone,
	"sort" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_line_kind_check" CHECK ("kind" in ('service', 'dispense', 'sale', 'administration', 'boarding_night', 'lab_test', 'other')),
	CONSTRAINT "invoice_line_service_check" CHECK ("kind" <> 'service' or "service_id" is not null),
	CONSTRAINT "invoice_line_description_check" CHECK (coalesce("description_az", "description_ru", "description_en") is not null),
	CONSTRAINT "invoice_line_quantity_check" CHECK ("quantity" > 0),
	CONSTRAINT "invoice_line_unit_price_check" CHECK ("unit_price_minor" >= 0),
	CONSTRAINT "invoice_line_discount_check" CHECK ("discount_minor" >= 0 and "discount_minor" <= "quantity" * "unit_price_minor"),
	CONSTRAINT "invoice_line_discount_reason_check" CHECK ("discount_minor" = 0 or coalesce("discount_reason", '') ~ '\S'),
	CONSTRAINT "invoice_line_total_check" CHECK ("total_minor" = round("quantity" * "unit_price_minor") - "discount_minor")
);
--> statement-breakpoint
CREATE TABLE "invoice_number_seq" (
	"id" uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000000',
	"last_value" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_number_seq_single_row" CHECK ("id" = '00000000-0000-0000-0000-000000000000'),
	CONSTRAINT "invoice_number_seq_last_value_check" CHECK ("last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"client_id" uuid,
	"kind" text NOT NULL,
	"amount_minor" minor_units NOT NULL,
	"currency" currency_code DEFAULT 'AZN' NOT NULL,
	"invoice_id" uuid,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ledger_entry_kind_check" CHECK ("kind" in ('charge', 'charge_reversal', 'payment', 'refund', 'adjustment', 'opening_balance', 'write_off')),
	CONSTRAINT "ledger_entry_invoice_check" CHECK ("kind" not in ('charge', 'charge_reversal', 'write_off') or "invoice_id" is not null),
	CONSTRAINT "ledger_entry_occurred_at_check" CHECK ("occurred_at" <= now())
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name_az" text,
	"name_ru" text,
	"name_en" text,
	"category" text NOT NULL,
	"price_minor" minor_units NOT NULL,
	"currency" currency_code DEFAULT 'AZN' NOT NULL,
	"default_duration_min" integer,
	"requires_consent_scope" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "service_name_check" CHECK (coalesce("name_az", "name_ru", "name_en") is not null),
	CONSTRAINT "service_category_check" CHECK ("category" in ('consultation', 'procedure', 'lab', 'grooming', 'boarding', 'other')),
	CONSTRAINT "service_consent_scope_check" CHECK ("requires_consent_scope" is null or "requires_consent_scope" in ('surgery', 'anaesthesia', 'euthanasia', 'procedure')),
	CONSTRAINT "service_price_check" CHECK ("price_minor" >= 0),
	CONSTRAINT "service_duration_check" CHECK ("default_duration_min" is null or "default_duration_min" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_number_idx" ON "invoice" ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_encounter_live_idx" ON "invoice" ("encounter_id") WHERE "status" in ('draft', 'issued');--> statement-breakpoint
CREATE INDEX "invoice_location_idx" ON "invoice" ("location_id");--> statement-breakpoint
CREATE INDEX "invoice_client_idx" ON "invoice" ("client_id");--> statement-breakpoint
CREATE INDEX "invoice_patient_idx" ON "invoice" ("patient_id");--> statement-breakpoint
CREATE INDEX "invoice_encounter_idx" ON "invoice" ("encounter_id");--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_line_service_idx" ON "invoice_line" ("service_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_client_idx" ON "ledger_entry" ("client_id");--> statement-breakpoint
CREATE INDEX "ledger_entry_invoice_idx" ON "ledger_entry" ("invoice_id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_location_id_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "invoice_number_seq" ADD CONSTRAINT "invoice_number_seq_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "invoice_number_seq" ADD CONSTRAINT "invoice_number_seq_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_invoice_id_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id");--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "service" ADD CONSTRAINT "service_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
-- Hand written from here; drizzle-kit models tables, not cross module keys, triggers, views or functions
-- (docs/database.md, "Migrations"). The Client, Patient, Clinical Record and Inventory modules' tables are plain uuids
-- in the Billing module's schema.ts, their keys here (src/modules/README.md). An invoice stores the visit, patient and
-- client it is given and reads nothing of them (BL-2).
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id");
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_patient_id_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patient"("id");
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_encounter_id_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounter"("id");
--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_service_id_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id");
--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id");
--> statement-breakpoint
-- The two shared triggers on every new table (docs/database.md, "Tables and the registry"), or the grants pass refuses
-- the schema.
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "service" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "service" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "invoice_number_seq" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "invoice_number_seq" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "invoice" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "invoice" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "invoice_line" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "invoice_line" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "ledger_entry" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "ledger_entry" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
-- The set once class learns a second kind of exception (spec 0002, invoice_line: "while the invoice is a draft,
-- quantity, total_minor and sort may change; references and snapshots are fixed at insert"): an argument `free:<col>`
-- names a column that may change while the row lives, which an invoice line's quantity does until lock_parent()
-- freezes it with its invoice. Every other argument means what it meant (the rules and visit migrations): a named
-- column goes from null to a value once, `later:<col>` only later, any other column is frozen unless the first
-- argument is 'only'. vetora.set_once (VT002) for every refusal; the function keeps its owner, its search_path and its
-- revoked EXECUTE.
CREATE OR REPLACE FUNCTION "set_once"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  others_frozen boolean := coalesce(TG_ARGV[0] <> 'only', true);
  args text[] := CASE WHEN TG_ARGV[0] = 'only' THEN TG_ARGV[1:TG_NARGS - 1] ELSE TG_ARGV[0:TG_NARGS - 1] END;
  named text[] := ARRAY(SELECT arg FROM unnest(args) AS arg WHERE arg NOT LIKE 'later:%' AND arg NOT LIKE 'free:%');
  later text[] := ARRAY(SELECT substr(arg, 7) FROM unnest(args) AS arg WHERE arg LIKE 'later:%');
  free text[] := ARRAY(SELECT substr(arg, 6) FROM unnest(args) AS arg WHERE arg LIKE 'free:%');
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  col text;
  changed record;
BEGIN
  IF cardinality(named) + cardinality(later) = 0 THEN
    RAISE EXCEPTION 'set_once on %.% names no column', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  FOREACH col IN ARRAY named || later || free LOOP
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
    IF changed.key = ANY (free) THEN
      CONTINUE;
    ELSIF changed.key = ANY (later) THEN
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
-- The frozen by status class (table-classes.ts): once issued, void or discarded, nothing of an invoice changes (BL-6,
-- AC-4); a correction is a void and a new invoice (feature 8, which allows the status column then). A discarded draft
-- is a cancelled visit's.
CREATE TRIGGER "freeze_record" BEFORE UPDATE OR DELETE ON "invoice" FOR EACH ROW EXECUTE FUNCTION "freeze_record"('status', 'issued, void, discarded', '');
--> statement-breakpoint
-- An invoice's lines freeze with it (lock_parent(); spec 0002, "Conventions": frozen by status): a line added, changed
-- or removed on an issued invoice is refused with vetora.frozen_record, and one written during the issue waits for its
-- lock and is refused then. While the invoice is a draft, a line's references and snapshots stay as inserted, its
-- quantity, total and sort change, and it is removed once (set_once()).
CREATE TRIGGER "lock_parent" BEFORE INSERT OR UPDATE OR DELETE ON "invoice_line" FOR EACH ROW EXECUTE FUNCTION "lock_parent"('invoice', 'invoice_id', 'status', 'issued, void, discarded');
--> statement-breakpoint
CREATE TRIGGER "set_once" BEFORE UPDATE ON "invoice_line" FOR EACH ROW EXECUTE FUNCTION "set_once"('removed_at', 'free:quantity', 'free:total_minor', 'free:sort');
--> statement-breakpoint
-- BL-6: a client's balance is the sum of their ledger rows, never a stored figure (spec 0002, "Interface surface":
-- client_balance; "Value sourcing": Show a client's balance). Rows without a client (a counter sale) are in no balance.
-- Positive is Balance due, negative a Prepayment (docs/domain.md §7.4). The practice role reads it (table-classes.ts).
CREATE VIEW "client_balance" AS
  SELECT "client_id", sum("amount_minor")::minor_units AS "balance_minor", "currency"
  FROM "ledger_entry"
  WHERE "client_id" IS NOT NULL
  GROUP BY "client_id", "currency";
--> statement-breakpoint
-- The gapless invoice number (spec 0002, "Interface surface": next_invoice_number(); "Value sourcing": Issue an
-- invoice): the counter row advanced by one and its new value returned, as text, which is the number until the
-- accountant asks for a richer format (OPEN-7). The UPDATE holds the row's lock to the end of the issuing transaction,
-- so a second issue waits for the first, and a rolled back issue gives its value back: no gap, no duplicate, which a
-- Postgres sequence cannot promise. It runs as its owner (the practice role reads the counter and never writes it)
-- with search_path pinned to pg_catalog, so the counter is named with its schema, written into the function as this
-- migration creates it in each practice schema (the migrate command sets search_path to that schema first). Its
-- set_updated_at trigger names the actor, and refuses a call without one (IN-1).
DO $migration$
BEGIN
  EXECUTE format(
    $function$
      CREATE FUNCTION %1$I."next_invoice_number"() RETURNS text
        LANGUAGE sql SECURITY DEFINER
        SET search_path = pg_catalog
      AS $body$
        UPDATE %1$I."invoice_number_seq" SET "last_value" = "last_value" + 1 RETURNING "last_value"::text
      $body$
    $function$,
    current_schema()
  );
END
$migration$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "next_invoice_number"() FROM PUBLIC;
--> statement-breakpoint
-- BL-6, AC-4: the deferred check at issue (spec 0002, invoice: "Deferred checks at issue: exactly one charge
-- ledger_entry equal to the sum of its live lines"; docs/database.md, "Deferred checks"). At commit, an invoice that is
-- issued (or void, which keeps its charge beside its reversal) has at least one line not removed
-- (vetora.incomplete_invoice: invoice_line) and exactly one charge entry, of its client and currency, equal to the sum
-- of those lines' totals (vetora.incomplete_invoice: ledger_entry); and a charge entry names an invoice that is issued
-- or void (vetora.incomplete_invoice: invoice), so no balance carries a draft. One function for both tables, the
-- trigger argument naming the column that holds the invoice's id; it reads the invoice by id as it stands at commit.
-- Later slices add their companions at issue here (a sale line's movement, a consent).
CREATE FUNCTION "assert_invoice"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  target uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  inv_status text;
  inv_client uuid;
  inv_currency text;
  live_lines bigint;
  live_total numeric;
  charges bigint;
  charged numeric;
  charge_matches boolean;
BEGIN
  IF target IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('select status, client_id, currency from %I.invoice where id = $1', TG_TABLE_SCHEMA)
    INTO inv_status, inv_client, inv_currency USING target;
  IF inv_status IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format(
    'select count(*), coalesce(sum(amount_minor), 0),
            coalesce(bool_and(client_id is not distinct from $2 and currency = $3), true)
     from %I.ledger_entry where invoice_id = $1 and kind = ''charge''',
    TG_TABLE_SCHEMA
  ) INTO charges, charged, charge_matches USING target, inv_client, inv_currency;
  IF inv_status NOT IN ('issued', 'void') THEN
    IF charges > 0 THEN
      RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_invoice: invoice', ERRCODE = 'VT005';
    END IF;
    RETURN NULL;
  END IF;
  EXECUTE format(
    'select count(*), coalesce(sum(total_minor), 0) from %I.invoice_line where invoice_id = $1 and removed_at is null',
    TG_TABLE_SCHEMA
  ) INTO live_lines, live_total USING target;
  IF live_lines = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_invoice: invoice_line', ERRCODE = 'VT005';
  END IF;
  IF charges <> 1 OR charged <> live_total OR NOT charge_matches THEN
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_invoice: ledger_entry', ERRCODE = 'VT005';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_invoice"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "assert_invoice" AFTER INSERT OR UPDATE ON "invoice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_invoice"('id');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "assert_invoice" AFTER INSERT ON "ledger_entry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."kind" = 'charge') EXECUTE FUNCTION "assert_invoice"('invoice_id');
--> statement-breakpoint
-- The counter's one row, a data migration (docs/database.md, "Actor and audit": a writing migration names its own
-- folder), so a practice provisioned after it and one migrated from before it both start at zero. A rerun inserts
-- nothing.
select set_config('app.migration', '20261027150913_billing', true);
--> statement-breakpoint
INSERT INTO "invoice_number_seq" ("id", "last_value") VALUES ('00000000-0000-0000-0000-000000000000', 0) ON CONFLICT ("id") DO NOTHING;