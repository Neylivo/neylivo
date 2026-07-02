-- Ponoi — этап 2 миграции: Друзья и личные сообщения (DM).
-- Выполни в Supabase -> SQL Editor ПОСЛЕ schema.sql.

create table if not exists friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users on delete cascade,
  to_user   uuid not null references auth.users on delete cascade,
  from_name text not null,
  to_name   text not null,
  status text not null default 'pending',  -- pending | accepted | declined
  created_at timestamptz not null default now(),
  unique (from_user, to_user)
);

create table if not exists dm_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users on delete cascade,
  user_b uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references dm_threads on delete cascade,
  author uuid not null references auth.users on delete cascade,
  author_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table friend_requests enable row level security;
alter table dm_threads      enable row level security;
alter table dm_messages     enable row level security;

-- Заявки в друзья: видит и отправитель, и получатель
create policy "fr_read"   on friend_requests for select using (auth.uid() = from_user or auth.uid() = to_user);
create policy "fr_insert" on friend_requests for insert with check (auth.uid() = from_user);
-- Обновлять статус (принять/отклонить) может получатель; отправитель может отменить (удалить)
create policy "fr_update" on friend_requests for update using (auth.uid() = to_user or auth.uid() = from_user);
create policy "fr_delete" on friend_requests for delete using (auth.uid() = from_user or auth.uid() = to_user);

-- DM-треды: доступны только участникам
create policy "dt_read"   on dm_threads for select using (auth.uid() = user_a or auth.uid() = user_b);
create policy "dt_insert" on dm_threads for insert with check (auth.uid() = user_a or auth.uid() = user_b);

-- DM-сообщения: читать/писать могут только участники треда
create policy "dm_read" on dm_messages for select using (
  exists (select 1 from dm_threads t where t.id = dm_messages.thread_id
          and (t.user_a = auth.uid() or t.user_b = auth.uid()))
);
create policy "dm_insert" on dm_messages for insert with check (
  author = auth.uid() and exists (
    select 1 from dm_threads t where t.id = dm_messages.thread_id
    and (t.user_a = auth.uid() or t.user_b = auth.uid()))
);

-- Realtime стрим для заявок и DM
alter publication supabase_realtime add table friend_requests;
alter publication supabase_realtime add table dm_messages;
