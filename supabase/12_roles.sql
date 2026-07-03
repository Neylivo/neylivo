-- Ponoi — этап 12 миграции: цветные роли (как в Discord).
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 11_last_seen.sql.

create table if not exists server_roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  name text not null,
  color text not null default '#99aab5',
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table server_members add column if not exists role_id uuid references server_roles on delete set null;

alter table server_roles enable row level security;

-- Читают участники сервера; создаёт/меняет/удаляет только владелец
create policy "roles_read"   on server_roles for select using (is_member(server_id));
create policy "roles_insert" on server_roles for insert with check (
  exists (select 1 from servers s where s.id = server_id and s.owner = auth.uid()));
create policy "roles_update" on server_roles for update using (
  exists (select 1 from servers s where s.id = server_roles.server_id and s.owner = auth.uid()));
create policy "roles_delete" on server_roles for delete using (
  exists (select 1 from servers s where s.id = server_roles.server_id and s.owner = auth.uid()));

-- Владелец сервера может назначать роль участникам (обновлять role_id)
create policy "sm_update_role" on server_members for update using (
  exists (select 1 from servers s where s.id = server_members.server_id and s.owner = auth.uid()));

-- Realtime
alter publication supabase_realtime add table server_roles;
