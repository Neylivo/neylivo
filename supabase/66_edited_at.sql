-- v1.263.0: точное время правки сообщения — раньше подсказка «(изменено)» была
-- статичным текстом без реального времени (был только булев флаг edited,
-- миграция 10_message_extras.sql). Добавляем edited_at рядом с ним.
alter table messages    add column if not exists edited_at timestamptz;
alter table dm_messages add column if not exists edited_at timestamptz;
