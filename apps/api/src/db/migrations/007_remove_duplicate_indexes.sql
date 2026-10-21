-- Keep the checked definitions stable until this migration's transaction commits.
LOCK TABLE users, daily_entries IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  candidate RECORD;
  redundant_index OID;
BEGIN
  FOR candidate IN
    SELECT * FROM (VALUES
      ('daily_entries', 'idx_daily_entries_user_date', 'daily_entries_pkey', 'p', 'user_id,date', false),
      ('daily_entries', 'daily_entries_user_id_date_key', 'daily_entries_pkey', 'p', 'user_id,date', true),
      ('users', 'idx_users_email', 'users_email_key', 'u', 'email', false)
    ) AS pairs(table_name, removed_name, kept_constraint, constraint_type, columns, owned_unique)
  LOOP
    SELECT removed.indexrelid INTO redundant_index
    FROM pg_class table_row
    JOIN pg_namespace namespace ON namespace.oid = table_row.relnamespace
    JOIN pg_class removed_class ON removed_class.relnamespace = namespace.oid
      AND removed_class.relname = candidate.removed_name
    JOIN pg_index removed ON removed.indexrelid = removed_class.oid
      AND removed.indrelid = table_row.oid
    JOIN pg_constraint kept_constraint ON kept_constraint.conrelid = table_row.oid
      AND kept_constraint.conname = candidate.kept_constraint
    JOIN pg_index kept ON kept.indexrelid = kept_constraint.conindid
    JOIN pg_class kept_class ON kept_class.oid = kept.indexrelid
    JOIN pg_am method ON method.oid = kept_class.relam
    WHERE namespace.nspname = current_schema()
      AND table_row.relname = candidate.table_name AND table_row.relkind = 'r'
      AND kept_constraint.contype::text = candidate.constraint_type
      AND kept_constraint.convalidated AND NOT kept_constraint.condeferrable
      AND NOT kept_constraint.condeferred
      AND (SELECT string_agg(attribute.attname, ',' ORDER BY key.ordinality)
           FROM unnest(kept_constraint.conkey) WITH ORDINALITY AS key(number, ordinality)
           JOIN pg_attribute attribute ON attribute.attrelid = table_row.oid
             AND attribute.attnum = key.number AND attribute.attnotnull) = candidate.columns
      AND method.amname = 'btree' AND removed_class.relam = kept_class.relam
      AND removed.indkey = kept.indkey
      AND removed.indclass = kept.indclass
      AND removed.indcollation = kept.indcollation
      AND removed.indoption = kept.indoption
      AND removed.indnkeyatts = kept.indnkeyatts
      AND removed.indnatts = removed.indnkeyatts AND kept.indnatts = kept.indnkeyatts
      AND removed.indexprs IS NULL AND kept.indexprs IS NULL
      AND removed.indpred IS NULL AND kept.indpred IS NULL
      AND removed.indisvalid AND kept.indisvalid
      AND removed.indisready AND kept.indisready
      AND removed.indislive AND kept.indislive
      AND removed.indimmediate AND kept.indimmediate AND kept.indisunique
      AND removed.indisunique = candidate.owned_unique AND NOT removed.indisprimary
      AND NOT removed.indisreplident AND NOT removed.indisclustered;

    IF redundant_index IS NULL THEN
      RAISE EXCEPTION 'Index cleanup requires equivalent valid indexes: %', candidate.removed_name;
    END IF;

    -- Standalone indexes must not own constraints; the redundant UNIQUE must
    -- belong to exactly the historical, non-deferrable UNIQUE constraint.
    IF (SELECT count(*) FROM pg_constraint WHERE conindid = redundant_index
        AND contype IN ('p', 'u', 'x')) <> candidate.owned_unique::int
      OR (candidate.owned_unique AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conindid = redundant_index
          AND conname = candidate.removed_name AND contype = 'u'
          AND convalidated AND NOT condeferrable AND NOT condeferred
      )) THEN
      RAISE EXCEPTION 'Index cleanup found unexpected constraint ownership: %', candidate.removed_name;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_depend
      WHERE refclassid = 'pg_class'::regclass AND refobjid = redundant_index
    ) OR EXISTS (
      SELECT 1 FROM pg_depend dependency
      JOIN pg_constraint constraint_row ON constraint_row.oid = dependency.refobjid
      WHERE dependency.refclassid = 'pg_constraint'::regclass
        AND constraint_row.conindid = redundant_index
        AND NOT (dependency.classid = 'pg_class'::regclass
          AND dependency.objid = redundant_index AND dependency.deptype = 'i')
    ) THEN
      RAISE EXCEPTION 'Index cleanup found dependent objects: %', candidate.removed_name;
    END IF;
  END LOOP;
END;
$$;

DROP INDEX idx_daily_entries_user_date;
ALTER TABLE daily_entries DROP CONSTRAINT daily_entries_user_id_date_key;
DROP INDEX idx_users_email;
