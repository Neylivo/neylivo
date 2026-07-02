-- Ponoi — этап 3 миграции: участники серверов + приглашения, жёсткий RLS.
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 02_friends_dm.sql.

create table if not exists server_members (
  server_id uuid not null references servers on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  member_name text not null,
  role text not null default 'member',   -- owner | member
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table if not exists server_invites (
  code text primary key,
  server_id uuid not null references servers on delete cascade,
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

alter table server_members enable row level security;
alter table server_invites enable row level security;

-- Хелпер: является ли текущий пользователь участником сервера
create or replace function is_member(sid uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from server_members m where m.server_id = sid and m.user_id = auth.uid());
$$;

-- Бэкофилл: владельцы уже существующих серверов становятся участниками-владельцами
insert into server_members (server_id, user_id, member_name, role)
select s.id, s.owner, coalesce(p.username, 'owner'), 'owner'
from servers s left join profiles p on p.id = s.owner
on conflict do nothing;

-- server_members RLS
create policy "sm_read"   on server_members for select using (is_member(server_id));
create policy "sm_insert" on server_members for insert with check (user_id = auth.uid());
create policy "sm_delete" on server_members for delete using (user_id = auth.uid());

-- server_invites RLS: участники создают/читают; присоединяющийся читает по коду
create policy "si_read"   on server_invites for select using (true);
create policy "si_insert" on server_invites for insert with check (is_member(server_id));

-- ====== Пересоздаём политики серверов/каналов/сообщений: только участники ======
drop policy if exists "servers_read"    on servers;
drop policy if exists "channels_read"   on channels;
drop policy if exists "channels_insert" on channels;
drop policy if exists "messages_read"   on messages;
drop policy if exists "messages_insert" on messages;

create policy "servers_read" on servers for select using (is_member(id) or owner = auth.uid());

create policy "channels_read"   on channels for select using (is_member(server_id));
create policy "channels_insert" on channels for insert with check (is_member(server_id));

create policy "messages_read"   on messages for select using (
  exists (select 1 from channels c where c.id = messages.channel_id and is_member(c.server_id))
);
create policy "messages_insert" on messages for insert with check (
  author = auth.uid() and exists (
    select 1 from channels c where c.id = messages.channel_id and is_member(c.server_id))
);

alter publication supabase_realtime add table server_members;
