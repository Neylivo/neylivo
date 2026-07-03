-- Ponoi — этап 10 миграции: ответы на сообщения и редактирование.
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 09_soundboard.sql.

-- Ответы (превью хранится прямо в строке, чтобы не делать джойны)
alter table messages    add column if not exists reply_to uuid;
alter table messages    add column if not exists reply_author text;
alter table messages    add column if not exists reply_preview text;
alter table messages    add column if not exists edited boolean not null default false;

alter table dm_messages add column if not exists reply_to uuid;
alter table dm_messages add column if not exists reply_author text;
alter table dm_messages add column if not exists reply_preview text;
alter table dm_messages add column if not exists edited boolean not null default false;

-- Редактирование своих сообщений (в дополнение к политикам закрепления из 05).
-- Несколько permissive-политик на UPDATE объединяются по ИЛИ.
create policy "messages_update_edit"    on messages    for update using (author = auth.uid());
create policy "dm_messages_update_edit" on dm_messages for update using (author = auth.uid());