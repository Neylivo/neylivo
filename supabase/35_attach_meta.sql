-- 35_attach_meta.sql — редактируемое название/описание вложения + переключаемый
-- спойлер после отправки (v1.157.0). Массив в attach_meta выровнен по индексу
-- с группой вложений, закодированной в attach_url через '\n' (миграция v1.70.0,
-- см. Composer.tsx) — элемент i описывает i-е вложение: { name?, desc? } | null.
-- Отдельной RLS-политики не нужно: автор уже может обновлять свою строку
-- целиком через messages_update_pin/dm_messages_update_pin (миграция 05).
alter table messages    add column if not exists attach_meta jsonb;
alter table dm_messages add column if not exists attach_meta jsonb;
