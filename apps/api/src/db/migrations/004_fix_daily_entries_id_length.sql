-- Увеличиваем длину поля id для хранения userId-date
ALTER TABLE daily_entries ALTER COLUMN id TYPE VARCHAR(255);
