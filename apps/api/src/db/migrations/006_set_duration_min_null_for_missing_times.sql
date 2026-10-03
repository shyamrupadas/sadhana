-- Normalize sleep_data fields: rename keys, allow nulls, and update defaults.

ALTER TABLE daily_entries
  ALTER COLUMN sleep_data
  SET DEFAULT '{"bedtime": null, "wakeTime": null, "napDuration": null, "duration": null}'::jsonb;

UPDATE daily_entries
SET sleep_data = (sleep_data - 'napDurationMin' - 'durationMin') ||
  jsonb_build_object(
    'napDuration', COALESCE(sleep_data->'napDuration', sleep_data->'napDurationMin'),
    'duration', COALESCE(sleep_data->'duration', sleep_data->'durationMin')
  )
WHERE (sleep_data ? 'napDurationMin') OR (sleep_data ? 'durationMin');

UPDATE daily_entries
SET sleep_data = jsonb_set(sleep_data, '{duration}', 'null'::jsonb, true)
WHERE (sleep_data->>'bedtime' IS NULL OR sleep_data->>'bedtime' = '')
   OR (sleep_data->>'wakeTime' IS NULL OR sleep_data->>'wakeTime' = '');

UPDATE daily_entries
SET sleep_data = jsonb_set(sleep_data, '{napDuration}', 'null'::jsonb, true)
WHERE (sleep_data->>'napDuration' IS NULL OR sleep_data->>'napDuration' = '' OR sleep_data->>'napDuration' = '0');
