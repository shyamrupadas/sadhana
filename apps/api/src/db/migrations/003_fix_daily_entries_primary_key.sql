-- Удаляем старый первичный ключ и создаем составной
ALTER TABLE daily_entries DROP CONSTRAINT IF EXISTS daily_entries_pkey;
ALTER TABLE daily_entries ADD PRIMARY KEY (user_id, date);

-- Удаляем старый уникальный индекс, так как теперь это первичный ключ
DROP INDEX IF EXISTS daily_entries_user_id_date;
