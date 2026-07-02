
-- Ponoi — этап 5 миграции: реакции (эмодзи) и закреплённые сообщения.
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 04_storage.sql.

-- Закреплённые сообщения
alter table messages    add column if not exists pinned boolean not null default false;
alter table dm_messages add column if not exists pinned boolean not null default false;

-- Реакции на сообщения каналов
create table if not exists reactions (
  message_id uuid not null references messages on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- Реакции на ЛС
create table if not exists dm_reactions (
  message_id uuid not null references dm_messages on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table reactions    enable row level security;
alter table dm_reactions enable row level security;

-- Реакции каналов: читать/ставить могут участники сервера; убрать — только свою
create policy "rx_read" on reactions for select using (
  exists (select 1 from messages m join channels c on c.id = m.channel_id
          where m.id = reactions.message_id and is_member(c.server_id))
);
create policy "rx_insert" on reactions for insert with check (
  user_id = auth.uid() and exists (
    select 1 from messages m join channels c on c.id = m.channel_id
    where m.id = reactions.message_id and is_member(c.server_id))
);
create policy "rx_delete" on reactions for delete using (user_id = auth.uid());

-- Реакции ЛС: читать/ставить могут участники треда; убрать — только свою
create policy "drx_read" on dm_reactions for select using (
  exists (select 1 from dm_messages dm join dm_threads t on t.id = dm.thread_id
          where dm.id = dm_reactions.message_id and (t.user_a = auth.uid() or t.user_b = auth.uid()))
);
create policy "drx_insert" on dm_reactions for insert with check (
  user_id = auth.uid() and exists (
    select 1 from dm_messages dm join dm_threads t on t.id = dm.thread_id
    where dm.id = dm_reactions.message_id and (t.user_a = auth.uid() or t.user_b = auth.uid()))
);
create policy "drx_delete" on dm_reactions for delete using (user_id = auth.uid());

-- Удаление своих сообщений (для контекст-меню)
create policy "messages_delete"    on messages    for delete using (author = auth.uid());
create policy "dm_messages_delete" on dm_messages for delete using (author = auth.uid());

-- Закрепление: автор или владелец сервера может закрепить/открепить сообщение канала
create policy "messages_update_pin" on messages for update using (
  author = auth.uid() or exists (
    select 1 from channels c join servers s on s.id = c.server_id
    where c.id = messages.channel_id and s.owner = auth.uid())
);
-- Закрепление ЛС: любой участник треда
create policy "dm_messages_update_pin" on dm_messages for update using (
  exists (select 1 from dm_threads t where t.id = dm_messages.thread_id
          and (t.user_a = auth.uid() or t.user_b = auth.uid()))
);

-- Realtime
alter publication supabase_realtime add table reactions;
alter publication supabase_realtime add table dm_reactions;
