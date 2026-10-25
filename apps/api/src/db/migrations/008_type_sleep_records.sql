-- Runner wraps validation, copying, reconciliation and cleanup in one transaction.
LOCK TABLE daily_entries IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM daily_entries
    WHERE date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR date::date::text <> date
      OR jsonb_typeof(sleep_data) <> 'object'
      OR EXISTS (
        SELECT 1 FROM jsonb_each(sleep_data) field
        WHERE field.key NOT IN ('bedtime', 'wakeTime', 'napDuration', 'duration')
      )
      OR EXISTS (
        SELECT 1 FROM (VALUES (sleep_data->'bedtime'), (sleep_data->'wakeTime')) time(value)
        WHERE value <> 'null'::jsonb AND (
          jsonb_typeof(value) <> 'string'
          OR value #>> '{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?$'
        )
      )
      OR (sleep_data->'napDuration' IS NOT NULL AND sleep_data->'napDuration' <> 'null'::jsonb AND (
        jsonb_typeof(sleep_data->'napDuration') <> 'number'
        OR sleep_data->>'napDuration' !~ '^[0-9]+$'
      ))
  ) THEN
    RAISE EXCEPTION 'Invalid legacy sleep facts; source preserved';
  END IF;
END $$;

CREATE TEMP TABLE expected_sleep ON COMMIT DROP AS
SELECT user_id, date::date AS date,
       (sleep_data->>'bedtime')::timestamp without time zone AS bedtime,
       (sleep_data->>'wakeTime')::timestamp without time zone AS wake_time,
       (sleep_data->>'napDuration')::integer AS nap_minutes
FROM daily_entries;

CREATE TABLE sleep_records (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  bedtime TIMESTAMP WITHOUT TIME ZONE,
  wake_time TIMESTAMP WITHOUT TIME ZONE,
  nap_minutes INTEGER CHECK (nap_minutes >= 0),
  PRIMARY KEY (user_id, date)
);

INSERT INTO sleep_records SELECT * FROM expected_sleep;

DO $$
BEGIN
  IF (SELECT count(*) FROM expected_sleep) <> (SELECT count(*) FROM sleep_records)
     OR EXISTS (SELECT * FROM expected_sleep EXCEPT SELECT * FROM sleep_records)
     OR EXISTS (SELECT * FROM sleep_records EXCEPT SELECT * FROM expected_sleep)
  THEN
    RAISE EXCEPTION 'Sleep reconciliation failed; source preserved';
  END IF;
END $$;

ALTER TABLE daily_entries DROP COLUMN sleep_data;
