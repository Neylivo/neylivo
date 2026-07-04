-- Ponoi — этап 18 миграции: иерархия ролей + право «Управление сервером».
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 17_server_settings.sql.

-- Флаг «Управление сервером»: роль даёт доступ к настройкам сервера.
alter table server_roles add column if not exists manage boolean not null default false;

-- Настройки сервера может менять владелец ИЛИ участник с ролью, у которой manage = true.
drop policy if exists "servers_update" on servers;
create policy "servers_update" on servers for update using (
  auth.uid() = owner
  or exists (
    select 1 from server_members sm
    join server_roles sr on sr.id = sm.role_id
    where sm.server_id = servers.id and sm.user_id = auth.uid() and sr.manage
  )
);
