-- Миграция для перемещения bedtime в записи предыдущего дня и пересчета durationMin
-- Выполняется в транзакции для обеспечения целостности данных

DO $$
DECLARE
  rec RECORD;
  prev_date VARCHAR(10);
  next_date VARCHAR(10);
  prev_sleep_data JSONB;
  next_sleep_data JSONB;
  prev_habits JSONB;
  prev_entry_id VARCHAR(255);
  current_sleep_data JSONB;
  bedtime_val TEXT;
  wake_time_val TEXT;
  nap_duration_min_val INTEGER;
  duration_min_val INTEGER;
  bed_dayjs TIMESTAMP;
  wake_dayjs TIMESTAMP;
  diff_minutes INTEGER;
BEGIN
  -- Шаг 1: Перемещение bedtime в записи предыдущего дня
  -- Обрабатываем от старых к новым, чтобы не перезаписывать уже перемещенные данные
  FOR rec IN 
    SELECT id, user_id, date, sleep_data, habits 
    FROM daily_entries 
    WHERE sleep_data->>'bedtime' IS NOT NULL 
      AND sleep_data->>'bedtime' != 'null'
    ORDER BY date ASC
  LOOP
    -- Вычисляем предыдущую дату
    prev_date := TO_CHAR(rec.date::DATE - INTERVAL '1 day', 'YYYY-MM-DD');
    
    -- Получаем bedtime из текущей записи
    bedtime_val := rec.sleep_data->>'bedtime';
    
    -- Проверяем, существует ли запись за предыдущий день
    SELECT sleep_data, habits INTO prev_sleep_data, prev_habits
    FROM daily_entries
    WHERE user_id = rec.user_id AND date = prev_date;
    
    IF prev_sleep_data IS NULL THEN
      -- Создаем новую запись за предыдущий день с bedtime
      prev_entry_id := rec.user_id || '-' || prev_date;
      prev_sleep_data := jsonb_build_object(
        'bedtime', bedtime_val,
        'wakeTime', NULL,
        'napDurationMin', 0,
        'durationMin', 0
      );
      prev_habits := COALESCE(rec.habits, '[]'::jsonb);
      
      INSERT INTO daily_entries (id, user_id, date, sleep_data, habits)
      VALUES (prev_entry_id, rec.user_id, prev_date, prev_sleep_data, prev_habits);
    ELSE
      -- Обновляем существующую запись за предыдущий день
      -- НЕ перезаписываем существующий bedtime, если он уже есть
      IF prev_sleep_data->>'bedtime' IS NULL OR prev_sleep_data->>'bedtime' = 'null' THEN
        prev_sleep_data := prev_sleep_data || jsonb_build_object('bedtime', bedtime_val);
        
        UPDATE daily_entries
        SET sleep_data = prev_sleep_data, updated_at = NOW()
        WHERE user_id = rec.user_id AND date = prev_date;
      END IF;
    END IF;
    
    -- Проверяем, есть ли запись за следующий день с bedtime
    -- Если есть - устанавливаем null (так как этот bedtime будет перемещен из следующей записи)
    -- Если нет - оставляем bedtime (это последняя запись)
    next_date := TO_CHAR(rec.date::DATE + INTERVAL '1 day', 'YYYY-MM-DD');
    
    SELECT sleep_data INTO next_sleep_data
    FROM daily_entries
    WHERE user_id = rec.user_id 
      AND date = next_date
      AND sleep_data->>'bedtime' IS NOT NULL 
      AND sleep_data->>'bedtime' != 'null';
    
    -- Устанавливаем bedtime = null только если есть запись за следующий день с bedtime
    IF next_sleep_data IS NOT NULL THEN
      current_sleep_data := rec.sleep_data;
      current_sleep_data := current_sleep_data || jsonb_build_object('bedtime', NULL);
      
      UPDATE daily_entries
      SET sleep_data = current_sleep_data, updated_at = NOW()
      WHERE id = rec.id;
    END IF;
  END LOOP;
  
  -- Шаг 2: Пересчет durationMin для всех записей
  FOR rec IN 
    SELECT id, user_id, date, sleep_data
    FROM daily_entries
  LOOP
    -- Вычисляем предыдущую дату
    prev_date := TO_CHAR(rec.date::DATE - INTERVAL '1 day', 'YYYY-MM-DD');
    
    -- Получаем данные из записи за предыдущий день
    SELECT sleep_data INTO prev_sleep_data
    FROM daily_entries
    WHERE user_id = rec.user_id AND date = prev_date;
    
    -- Извлекаем значения из текущей записи
    wake_time_val := rec.sleep_data->>'wakeTime';
    nap_duration_min_val := COALESCE((rec.sleep_data->>'napDurationMin')::INTEGER, 0);
    
    -- Извлекаем bedtime из записи за предыдущий день
    IF prev_sleep_data IS NOT NULL THEN
      bedtime_val := prev_sleep_data->>'bedtime';
    ELSE
      bedtime_val := NULL;
    END IF;
    
    -- Рассчитываем durationMin
    IF bedtime_val IS NOT NULL AND bedtime_val != 'null' AND wake_time_val IS NOT NULL AND wake_time_val != 'null' THEN
      bed_dayjs := bedtime_val::TIMESTAMP;
      wake_dayjs := wake_time_val::TIMESTAMP;
      diff_minutes := EXTRACT(EPOCH FROM (wake_dayjs - bed_dayjs)) / 60;
      
      -- Если разница отрицательная, значит сон перешел через полночь
      IF diff_minutes < 0 THEN
        diff_minutes := diff_minutes + 24 * 60;
      END IF;
      
      duration_min_val := nap_duration_min_val + diff_minutes;
    ELSE
      duration_min_val := nap_duration_min_val;
    END IF;
    
    -- Обновляем durationMin в текущей записи
    current_sleep_data := rec.sleep_data;
    current_sleep_data := current_sleep_data || jsonb_build_object('durationMin', duration_min_val);
    
    UPDATE daily_entries
    SET sleep_data = current_sleep_data, updated_at = NOW()
    WHERE id = rec.id;
  END LOOP;
END $$;
