CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"location_id" uuid NOT NULL,
	"client_id" uuid,
	"method" text NOT NULL,
	"amount_minor" minor_units NOT NULL,
	"currency" currency_code DEFAULT 'AZN' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"business_date" date NOT NULL,
	"received_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_method_check" CHECK ("method" in ('cash', 'card', 'transfer')),
	CONSTRAINT "payment_amount_check" CHECK ("amount_minor" <> 0),
	CONSTRAINT "payment_occurred_at_check" CHECK ("occurred_at" <= now())
);
--> statement-breakpoint
CREATE TABLE "payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" minor_units NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payment_allocation_amount_check" CHECK ("amount_minor" <> 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entry_payment_idx" ON "ledger_entry" ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_location_day_idx" ON "payment" ("location_id","business_date");--> statement-breakpoint
CREATE INDEX "payment_client_idx" ON "payment" ("client_id");--> statement-breakpoint
CREATE INDEX "payment_received_by_idx" ON "payment" ("received_by");--> statement-breakpoint
CREATE INDEX "payment_allocation_payment_idx" ON "payment_allocation" ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_allocation_invoice_idx" ON "payment_allocation" ("invoice_id");--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_payment_id_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_location_id_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_received_by_staff_member_id_fkey" FOREIGN KEY ("received_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id");--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoice_id_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id");--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_created_by_staff_member_id_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_updated_by_staff_member_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "staff_member"("id");--> statement-breakpoint
ALTER TABLE "ledger_entry" ADD CONSTRAINT "ledger_entry_payment_check" CHECK (("kind" in ('payment', 'refund')) = ("payment_id" is not null));
--> statement-breakpoint
-- Hand written from here; drizzle-kit models tables, not cross module keys, triggers or functions (docs/database.md,
-- "Migrations"). The Client module's table is a plain uuid in the Billing module's schema.ts, its key here
-- (src/modules/README.md).
ALTER TABLE "payment" ADD CONSTRAINT "payment_client_id_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id");
--> statement-breakpoint
-- The two shared triggers on every new table (docs/database.md, "Tables and the registry"), or the grants pass refuses
-- the schema.
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "payment" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "payment" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "payment_allocation" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();
--> statement-breakpoint
CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "payment_allocation" FOR EACH ROW EXECUTE FUNCTION "audit_row"();
--> statement-breakpoint
-- An event table's window (AC-13; the rules migration): occurred_at back datable within
-- practice_settings.backdate_limit_hours, beside the table's CHECK that keeps it out of the future. Feature 5 takes
-- every payment now; the window holds for the day a payment is entered later. The lock of a closed day (spec 0002:
-- rejected when a cash_day_close exists for its location and business_date) arrives with that table in slice 3.
CREATE TRIGGER "assert_backdate_limit" BEFORE INSERT OR UPDATE ON "payment" FOR EACH ROW EXECUTE FUNCTION "assert_backdate_limit"();
--> statement-breakpoint
-- BL-6, AC-4: a payment moves the client's balance through its ledger entry (spec 0002, payment: "Deferred check: one
-- ledger entry of kind payment or refund references it"; docs/database.md, "Deferred checks"). At commit, a payment has
-- exactly one entry naming it (the unique index keeps it to one), of kind payment for a positive amount and refund for
-- a negative one, of the payment's client and currency and of its amount negated, so a balance always equals charges
-- less payments (vetora.incomplete_payment: ledger_entry). One function for both tables, the trigger argument naming
-- the column that holds the payment's id; it reads the payment by id as it stands at commit. A payment row gone by
-- then leaves nothing to check; an entry naming a payment that is not there is refused (vetora.incomplete_payment:
-- payment), which its foreign key already prevents: the guard fails closed (CODING_STANDARDS.md).
CREATE FUNCTION "assert_payment"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  target uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  pay_amount numeric;
  pay_client uuid;
  pay_currency text;
  entries bigint;
  entry_matches boolean;
BEGIN
  IF target IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format('select amount_minor, client_id, currency from %I.payment where id = $1', TG_TABLE_SCHEMA)
    INTO pay_amount, pay_client, pay_currency USING target;
  IF pay_amount IS NULL THEN
    IF TG_TABLE_NAME = 'payment' THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_payment: payment', ERRCODE = 'VT005';
  END IF;
  EXECUTE format(
    'select count(*),
            coalesce(bool_and(kind = $2 and amount_minor = -$3 and client_id is not distinct from $4 and currency = $5), false)
     from %I.ledger_entry where payment_id = $1',
    TG_TABLE_SCHEMA
  ) INTO entries, entry_matches
    USING target, CASE WHEN pay_amount > 0 THEN 'payment' ELSE 'refund' END, pay_amount, pay_client, pay_currency;
  IF entries <> 1 OR NOT entry_matches THEN
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_payment: ledger_entry', ERRCODE = 'VT005';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_payment"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "assert_payment" AFTER INSERT OR UPDATE ON "payment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_payment"('id');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "assert_payment" AFTER INSERT ON "ledger_entry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW."payment_id" IS NOT NULL) EXECUTE FUNCTION "assert_payment"('payment_id');
--> statement-breakpoint
-- BL-5, BL-6, AC-4: what a payment paid (spec 0002, payment_allocation: "Deferred check: per invoice the allocation sum
-- stays between zero and the invoice total; per payment it stays within the payment amount; the handler locks the
-- invoice row first"). At commit, for the allocation's invoice: it is issued (or void, which keeps its allocations
-- beside their reversals), of the payment's client and currency, and its allocations add up to between zero and its
-- live lines' total, which its one charge equals (vetora.incomplete_allocation: invoice); for its payment: its
-- allocations add up to between zero and its amount (vetora.incomplete_allocation: payment). It reads the allocation
-- by id as it stands at commit (gone by then, there is nothing to check), refuses an invoice or a payment it names
-- that is not there, which the foreign keys already prevent (the guard fails closed, CODING_STANDARDS.md), and locks
-- the invoice and then the payment (FOR NO KEY UPDATE): a second transaction
-- checking either waits here for the first to commit and then counts its rows, so two payments committing together
-- cannot both take the same remainder. The rows are counted after the locks, each statement reading what has committed
-- by then. The lock is not FOR UPDATE, which an allocation's own foreign key check (FOR KEY SHARE) would wait on, so
-- two transactions that each wrote an allocation would deadlock at commit; the handler's FOR UPDATE, taken before it
-- writes, still waits for this one.
CREATE FUNCTION "assert_allocation"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  alloc_payment uuid;
  alloc_invoice uuid;
  inv_status text;
  inv_client uuid;
  inv_currency text;
  pay_amount numeric;
  pay_client uuid;
  pay_currency text;
  invoice_total numeric;
  invoice_allocated numeric;
  payment_allocated numeric;
BEGIN
  EXECUTE format('select payment_id, invoice_id from %I.payment_allocation where id = $1', TG_TABLE_SCHEMA)
    INTO alloc_payment, alloc_invoice USING NEW.id;
  IF alloc_payment IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE format(
    'select status, client_id, currency from %I.invoice where id = $1 for no key update',
    TG_TABLE_SCHEMA
  ) INTO inv_status, inv_client, inv_currency USING alloc_invoice;
  EXECUTE format(
    'select amount_minor, client_id, currency from %I.payment where id = $1 for no key update',
    TG_TABLE_SCHEMA
  ) INTO pay_amount, pay_client, pay_currency USING alloc_payment;
  IF pay_amount IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_allocation: payment', ERRCODE = 'VT005';
  END IF;
  IF inv_status IS NULL OR inv_status NOT IN ('issued', 'void') OR inv_client IS DISTINCT FROM pay_client
    OR inv_currency IS DISTINCT FROM pay_currency THEN
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_allocation: invoice', ERRCODE = 'VT005';
  END IF;
  EXECUTE format(
    'select coalesce(sum(total_minor), 0) from %I.invoice_line where invoice_id = $1 and removed_at is null',
    TG_TABLE_SCHEMA
  ) INTO invoice_total USING alloc_invoice;
  EXECUTE format('select coalesce(sum(amount_minor), 0) from %I.payment_allocation where invoice_id = $1', TG_TABLE_SCHEMA)
    INTO invoice_allocated USING alloc_invoice;
  IF invoice_allocated < 0 OR invoice_allocated > invoice_total THEN
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_allocation: invoice', ERRCODE = 'VT005';
  END IF;
  EXECUTE format('select coalesce(sum(amount_minor), 0) from %I.payment_allocation where payment_id = $1', TG_TABLE_SCHEMA)
    INTO payment_allocated USING alloc_payment;
  IF payment_allocated < least(pay_amount, 0) OR payment_allocated > greatest(pay_amount, 0) THEN
    RAISE EXCEPTION USING MESSAGE = 'vetora.incomplete_allocation: payment', ERRCODE = 'VT005';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_allocation"() FROM PUBLIC;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "assert_allocation" AFTER INSERT OR UPDATE ON "payment_allocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "assert_allocation"();