ALTER TABLE "practice_settings" ADD CONSTRAINT "practice_settings_backdate_limit_hours_check" CHECK ("backdate_limit_hours" >= 0);
--> statement-breakpoint
-- Hand written from here; drizzle-kit modelled the check above (spec 0002, "Interface surface": set_once(),
-- freeze_record(), lock_parent(), assert_*; "Key invariants"): the rules the database refuses to bend, as generic
-- trigger functions driven by their trigger arguments, never one function per table. One copy per practice schema
-- like every object of the set: SECURITY DEFINER, owned by vetora_migrator, search_path pinned to pg_catalog, the
-- practice schema addressed through TG_TABLE_SCHEMA, and executable by PUBLIC never (a trigger runs its function
-- without EXECUTE; the practice role calls none of them directly; spec 0002, "Security model": Owner run functions).
-- A refusal is RAISE EXCEPTION with a message that starts with the rule name and an SQLSTATE in the VT class, both
-- listed in src/platform/db/errors.ts; the message names tables, columns, and statuses, never a value. The rules hold
-- for every role, the owner included: a migration that must change a frozen row disables the trigger for its own
-- statement, in plain sight in the migration file.
-- BEFORE ROW triggers fire in name order, so every rule here sees the row as the statement sent it, before
-- set_updated_at() stamps the standard columns; updated_at, updated_by, and version never count as a change.

-- AC-9, the set once columns, and CR-1, RX-4, BL-6 behind them: a correction is a new row, never an edit (spec 0002,
-- "Conventions": Table classes; "Key invariants": Set once columns). BEFORE UPDATE. set_once(col, …) on a set once class table: each named column may go from null to a value once; any other
-- change to it, and any change to a column not named, raises vetora.set_once (VT002), so the class holds for every
-- role even where a grant is wider (the grants pass leaves the practice role UPDATE on the named columns alone).
-- set_once('only', col, …) watches the named columns alone: a set once column on a mutable table
-- (practice_settings.go_live_at). A misspelt column name fails the first update loudly rather than guarding nothing.
CREATE FUNCTION "set_once"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  others_frozen boolean := coalesce(TG_ARGV[0] <> 'only', true);
  named text[] := CASE WHEN TG_ARGV[0] = 'only' THEN TG_ARGV[1:TG_NARGS - 1] ELSE TG_ARGV[0:TG_NARGS - 1] END;
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := to_jsonb(NEW);
  col text;
  changed record;
BEGIN
  IF cardinality(named) = 0 THEN
    RAISE EXCEPTION 'set_once on %.% names no column', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  FOREACH col IN ARRAY named LOOP
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
    IF changed.key = ANY (named) THEN
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
REVOKE ALL ON FUNCTION "set_once"() FROM PUBLIC;
--> statement-breakpoint
-- practice_settings is mutable; go_live_at alone is set once (spec 0002, "Data model sketch": Platform and settings).
CREATE TRIGGER "set_once" BEFORE UPDATE ON "practice_settings" FOR EACH ROW EXECUTE FUNCTION "set_once"('only', 'go_live_at');
--> statement-breakpoint
-- CR-1, RX-4, BL-3, BL-6, IN-6 (spec 0002, "Key invariants": frozen records; "Conventions": Table classes, frozen by
-- status), BEFORE UPDATE OR DELETE: freeze_record(status_col, final_values, allowed_cols), the two lists comma
-- separated. Once the row's status is one of the final values, only the allowed columns may change and a DELETE is
-- refused, with vetora.frozen_record (VT003). The move into a final status is the row's last free change; a later move
-- between final values, or out of them, passes only when the status column is itself allowed (an issued invoice going
-- void), and the slice's own trigger then guards the direction. A correction is a new row (encounter_amendment). A
-- misspelt column name fails the first write loudly; a misspelt status value is not caught (the table's CHECK is not
-- consulted), which the slice's test seam is for.
CREATE FUNCTION "freeze_record"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  status_col text := TG_ARGV[0];
  final_values text[] := string_to_array(regexp_replace(TG_ARGV[1], '\s', '', 'g'), ',');
  allowed text[] := string_to_array(regexp_replace(TG_ARGV[2], '\s', '', 'g'), ',');
  old_row jsonb := to_jsonb(OLD);
  old_status text;
  col text;
  changed record;
BEGIN
  IF TG_NARGS <> 3 THEN
    RAISE EXCEPTION 'freeze_record on %.% takes status_col, final_values, allowed_cols', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF NOT old_row ? status_col THEN
    RAISE EXCEPTION 'freeze_record on %.% names a column the table does not have: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, status_col;
  END IF;
  FOREACH col IN ARRAY allowed LOOP
    IF NOT old_row ? col THEN
      RAISE EXCEPTION 'freeze_record on %.% allows a column the table does not have: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, col;
    END IF;
  END LOOP;
  old_status := old_row ->> status_col;
  IF old_status IS NULL OR NOT (old_status = ANY (final_values)) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      MESSAGE = format('vetora.frozen_record: %s is %s and cannot be deleted', TG_TABLE_NAME, old_status),
      ERRCODE = 'VT003';
  END IF;
  FOR changed IN
    SELECT n.key FROM jsonb_each(to_jsonb(NEW)) AS n JOIN jsonb_each(old_row) AS o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value
      AND n.key NOT IN ('updated_at', 'updated_by', 'version') AND NOT (n.key = ANY (allowed))
    ORDER BY n.key LIMIT 1
  LOOP
    RAISE EXCEPTION USING
      MESSAGE = format('vetora.frozen_record: %s is %s and %s cannot change', TG_TABLE_NAME, old_status, changed.key),
      ERRCODE = 'VT003';
  END LOOP;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "freeze_record"() FROM PUBLIC;
--> statement-breakpoint
-- CR-1 for the rows of a frozen record (spec 0002, "Conventions": Table classes, frozen by status: a child row insert
-- locks its parent FOR SHARE, so a child cannot slip in beside a concurrent freeze), BEFORE INSERT OR UPDATE OR DELETE
-- on the child: lock_parent(parent_table, fk_col, status_col, final_values). The parent row, and on an update that
-- moves the child the one it leaves too, is read FOR SHARE: an in flight freeze of it finishes first and this statement
-- then sees the final status; a parent in a final status refuses the insert, the change, or the delete with
-- vetora.frozen_record (VT003). A handler that freezes a parent locks it (FOR UPDATE) before it reads the children it
-- validates, so a child written during the freeze waits and is refused instead of slipping in. A parent id that
-- matches no row is left to the foreign key, which refuses the statement after this trigger.
CREATE FUNCTION "lock_parent"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  fk_col text := TG_ARGV[1];
  status_col text := TG_ARGV[2];
  final_values text[] := string_to_array(regexp_replace(TG_ARGV[3], '\s', '', 'g'), ',');
  row_json jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  parent_ids uuid[];
  parent_id uuid;
  parent_status text;
BEGIN
  IF TG_NARGS <> 4 THEN
    RAISE EXCEPTION 'lock_parent on %.% takes parent_table, fk_col, status_col, final_values', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF NOT row_json ? fk_col THEN
    RAISE EXCEPTION 'lock_parent on %.% names a column the table does not have: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, fk_col;
  END IF;
  parent_ids := ARRAY[(row_json ->> fk_col)::uuid];
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> fk_col) IS DISTINCT FROM (to_jsonb(NEW) ->> fk_col) THEN
    parent_ids := parent_ids || (to_jsonb(OLD) ->> fk_col)::uuid;
  END IF;
  FOREACH parent_id IN ARRAY parent_ids LOOP
    CONTINUE WHEN parent_id IS NULL;
    EXECUTE format('select %I::text from %I.%I where id = $1 for share', status_col, TG_TABLE_SCHEMA, parent_table)
      INTO parent_status USING parent_id;
    IF parent_status = ANY (final_values) THEN
      RAISE EXCEPTION USING
        MESSAGE = format('vetora.frozen_record: %s is %s and %s cannot change', parent_table, parent_status, TG_TABLE_NAME),
        ERRCODE = 'VT003';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "lock_parent"() FROM PUBLIC;
--> statement-breakpoint
-- AC-13 (spec 0002, "Conventions": Time; "Value sourcing": occurred_at): an event's occurred_at is what the staff member
-- says happened, never in the future and back datable within practice_settings.backdate_limit_hours of now(). The
-- future half is a CHECK on the table (occurred_at <= now()), which stays true on a restore since past times stay
-- past; the window is this trigger, BEFORE INSERT OR UPDATE, because old rows could not satisfy it as a CHECK when
-- restored. It reads the practice's limit from practice_settings in the row's schema and refuses an occurred_at
-- earlier than now() minus the limit with vetora.backdated_too_far (VT004); an update that leaves occurred_at as it
-- was is not measured again, so an old row's other columns stay editable. A practice without its settings row refuses
-- every event rather than letting one through. The convention for every event table is the CHECK plus this trigger;
-- "editable only while the parent record is a draft" is the parent's freeze_record. The name is the ticket's: the
-- assert_ prefix otherwise belongs to the deferred checks, and this one is immediate.
CREATE FUNCTION "assert_backdate_limit"() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  limit_hours integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.occurred_at IS NOT DISTINCT FROM OLD.occurred_at THEN
    RETURN NEW;
  END IF;
  EXECUTE format('select backdate_limit_hours from %I.practice_settings', TG_TABLE_SCHEMA) INTO limit_hours;
  IF limit_hours IS NULL THEN
    RAISE EXCEPTION 'assert_backdate_limit on %.%: practice_settings has no row', TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  IF NEW.occurred_at < now() - make_interval(hours => limit_hours) THEN
    RAISE EXCEPTION USING
      MESSAGE = format('vetora.backdated_too_far: %s.occurred_at is more than %s hours before now', TG_TABLE_NAME, limit_hours),
      ERRCODE = 'VT004';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "assert_backdate_limit"() FROM PUBLIC;
