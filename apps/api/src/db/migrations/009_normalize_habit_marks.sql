-- One runner transaction keeps the legacy source intact on any failure.
LOCK TABLE habits, daily_entries IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM daily_entries WHERE jsonb_typeof(habits) <> 'array'
    OR date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR date::date::text <> date) THEN
    RAISE EXCEPTION 'Invalid legacy habit source; source preserved';
  END IF;
  IF EXISTS (
    SELECT 1 FROM daily_entries d CROSS JOIN LATERAL jsonb_array_elements(d.habits) m
    WHERE jsonb_typeof(m) <> 'object' OR jsonb_typeof(m->'key') IS DISTINCT FROM 'string'
      OR m->>'key' = '' OR jsonb_typeof(m->'value') IS DISTINCT FROM 'boolean'
      OR m - 'key' - 'value' <> '{}'::jsonb
  ) OR EXISTS (
    SELECT 1 FROM daily_entries d CROSS JOIN LATERAL jsonb_array_elements(d.habits) m
    GROUP BY d.user_id, d.date, m->>'key' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Invalid or colliding legacy marks; source preserved';
  END IF;
END $$;

CREATE TEMP TABLE expected_habit_marks ON COMMIT DROP AS
SELECT d.user_id, d.date::date AS date, h.id AS habit_id, (m->>'value')::boolean AS value
FROM daily_entries d CROSS JOIN LATERAL jsonb_array_elements(d.habits) m
JOIN habits h ON h.user_id = d.user_id AND h.key = m->>'key';

CREATE TEMP TABLE habit_cleanup_counts ON COMMIT DROP AS
SELECT count(*) AS source_count, count(*) FILTER (WHERE h.id IS NULL) AS orphan_count
FROM daily_entries d CROSS JOIN LATERAL jsonb_array_elements(d.habits) m
LEFT JOIN habits h ON h.user_id = d.user_id AND h.key = m->>'key';

DO $$
DECLARE removed bigint;
BEGIN
  SELECT orphan_count INTO removed FROM habit_cleanup_counts;
  RAISE NOTICE 'Pre-counted orphan habit marks to remove: %', removed;
END $$;

CREATE TEMP TABLE expected_habits ON COMMIT DROP AS
SELECT h.id, h.user_id, h.label, h.created_at,
  LEAST(h.created_at::date, (SELECT min(m.date) FROM expected_habit_marks m WHERE m.user_id = h.user_id AND m.habit_id = h.id)) AS start_date,
  false AS archived
FROM habits h;

ALTER TABLE habits ADD COLUMN start_date DATE;
ALTER TABLE habits ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE habits ADD CONSTRAINT habits_owner_id_unique UNIQUE (user_id, id);
UPDATE habits h SET start_date = e.start_date FROM expected_habits e WHERE h.id = e.id;

CREATE TABLE habit_marks (
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  habit_id UUID NOT NULL,
  value BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, date, habit_id),
  FOREIGN KEY (user_id, habit_id) REFERENCES habits(user_id, id) ON DELETE CASCADE
);
-- Range reads use the PK; lifecycle/deletion/count queries use this index.
CREATE INDEX habit_marks_owner_habit_date ON habit_marks (user_id, habit_id, date);
INSERT INTO habit_marks SELECT * FROM expected_habit_marks;

-- Reconcile before cleanup.
DO $$
BEGIN
  IF (SELECT count(*) FROM habit_marks) <> (SELECT source_count - orphan_count FROM habit_cleanup_counts)
    OR EXISTS (SELECT * FROM expected_habit_marks EXCEPT SELECT * FROM habit_marks)
    OR EXISTS (SELECT * FROM habit_marks EXCEPT SELECT * FROM expected_habit_marks)
    OR (SELECT count(*) FROM habits) <> (SELECT count(*) FROM expected_habits)
    OR EXISTS (SELECT * FROM expected_habits EXCEPT SELECT id, user_id, label, created_at, start_date, archived FROM habits)
    OR EXISTS (SELECT id, user_id, label, created_at, start_date, archived FROM habits EXCEPT SELECT * FROM expected_habits)
  THEN
    RAISE EXCEPTION 'Habit reconciliation failed; source preserved';
  END IF;
END $$;
ALTER TABLE daily_entries DROP COLUMN habits;
ALTER TABLE habits DROP COLUMN key;
