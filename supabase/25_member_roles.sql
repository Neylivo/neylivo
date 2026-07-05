-- Ponoi — этап 25 миграции: много ролей на участника + значок роли (v1.96.0).
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 24_nameplate.sql.

-- Участнику можно давать сколько угодно ролей (как в Discord).
create table if not exists member_roles (
  server_id uuid not null references servers on delete cascade,
  user_id uuid not null,
  role_id uuid not null references server_roles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id, role_id)
);

alter table member_roles enable row level security;

-- Читают участники сервера; выдаёт/снимает владелец или роль с «Управлением сервером».
create policy "mr_read" on member_roles for select using (is_member(server_id));
create policy "mr_insert" on member_roles for insert with check (
  exists (select 1 from servers s where s.id = server_id and s.owner = auth.uid())
  or exists (select 1 from server_members sm join server_roles sr on sr.id = sm.role_id
             where sm.server_id = member_roles.server_id and sm.user_id = auth.uid() and sr.manage)
  or exists (select 1 from member_roles mr join server_roles sr on sr.id = mr.role_id
             where mr.server_id = member_roles.server_id and mr.user_id = auth.uid() and sr.manage));
create policy "mr_delete" on member_roles for delete using (
  exists (select 1 from servers s where s.id = member_roles.server_id and s.owner = auth.uid())
  or exists (select 1 from server_members sm join server_roles sr on sr.id = sm.role_id
             where sm.server_id = member_roles.server_id and sm.user_id = auth.uid() and sr.manage)
  or exists (select 1 from member_roles mr join server_roles sr on sr.id = mr.role_id
             where mr.server_id = member_roles.server_id and mr.user_id = auth.uid() and sr.manage));

-- Переносим старые одиночные роли в новую таблицу.
insert into member_roles (server_id, user_id, role_id)
  select server_id, user_id, role_id from server_members where role_id is not null
  on conflict do nothing;

-- Значок роли (картинка < 256 Кб; у участника показывается значок высшей роли).
alter table server_roles add column if not exists icon_url text;

-- Realtime
alter publication supabase_realtime add table member_roles;
