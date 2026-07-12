-- v1.267.0: реальный журнал аудита — раньше вкладка «Журнал аудита» в
-- ServerSettings.tsx была честной заглушкой (фильтры задизейблены, «ЗАПИСЕЙ
-- ПОКА НЕТ» всегда). Теперь модераторские действия и правки структуры сервера
-- пишутся сюда: кик/бан/разбан/тайм-аут (уже существующие security-definer
-- функции, 34_permissions.sql/49_role_perms2.sql), создание/удаление каналов
-- и ролей (с клиента, через log_audit ниже — там нет отдельной RPC).
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  actor_id uuid not null,
  actor_name text not null,
  action text not null,
  target_name text,
  detail text,
  created_at timestamptz not null default now()
);
alter table audit_log enable row level security;

drop policy if exists "audit_read" on audit_log;
create policy "audit_read" on audit_log for select to authenticated using (
  exists (select 1 from servers s where s.id = audit_log.server_id and (
    s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 64) <> 0   -- VIEW_AUDIT_LOG = 64
  ))
);
-- Запись — только через security-definer функцию ниже (сама решает, что можно писать).

create or replace function log_audit(p_server uuid, p_action text, p_target_name text, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not exists (select 1 from server_members where server_id = p_server and user_id = auth.uid()) then
    raise exception 'not a member';
  end if;
  select coalesce(display_name, username, 'user') into v_name from profiles where id = auth.uid();
  insert into audit_log (server_id, actor_id, actor_name, action, target_name, detail)
  values (p_server, auth.uid(), coalesce(v_name, 'user'), p_action, p_target_name, p_detail);
end;
$$;

alter publication supabase_realtime add table audit_log;

-- Дописываем существующие security-definer функции модерации — сами пишут
-- в audit_log в конце своего тела (актор/права они уже проверили выше).
create or replace function kick_member(p_server uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor_pos int;
  v_target_pos int;
  v_target_name text;
begin
  select owner into v_owner from servers where id = p_server;
  if v_owner is null then raise exception 'server not found'; end if;
  if p_target = v_owner then raise exception 'cannot kick the owner'; end if;
  if p_target = auth.uid() then raise exception 'cannot kick yourself'; end if;
  if auth.uid() <> v_owner then
    if (server_permissions(p_server, auth.uid()) & 8) = 0 then raise exception 'missing KICK_MEMBERS permission'; end if;
    v_actor_pos := coalesce(top_role_position(p_server, auth.uid()), 999999);
    v_target_pos := coalesce(top_role_position(p_server, p_target), 999999);
    if v_actor_pos >= v_target_pos then raise exception 'cannot manage a member with an equal or higher role'; end if;
  end if;
  select member_name into v_target_name from server_members where server_id = p_server and user_id = p_target;
  delete from server_members where server_id = p_server and user_id = p_target;
  insert into audit_log (server_id, actor_id, actor_name, action, target_name)
    values (p_server, auth.uid(), coalesce((select display_name from profiles where id = auth.uid()), 'user'), 'kick', coalesce(v_target_name, p_target::text));
end;
$$;

create or replace function ban_member(p_server uuid, p_target uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor_pos int;
  v_target_pos int;
  v_target_name text;
begin
  select owner into v_owner from servers where id = p_server;
  if v_owner is null then raise exception 'server not found'; end if;
  if p_target = v_owner then raise exception 'cannot ban the owner'; end if;
  if p_target = auth.uid() then raise exception 'cannot ban yourself'; end if;
  if auth.uid() <> v_owner then
    if (server_permissions(p_server, auth.uid()) & 16) = 0 then raise exception 'missing BAN_MEMBERS permission'; end if;
    v_actor_pos := coalesce(top_role_position(p_server, auth.uid()), 999999);
    v_target_pos := coalesce(top_role_position(p_server, p_target), 999999);
    if v_actor_pos >= v_target_pos then raise exception 'cannot manage a member with an equal or higher role'; end if;
  end if;
  select member_name into v_target_name from server_members where server_id = p_server and user_id = p_target;
  insert into server_bans (server_id, user_id, banned_by, reason) values (p_server, p_target, auth.uid(), p_reason)
    on conflict (server_id, user_id) do update set banned_by = excluded.banned_by, reason = excluded.reason, created_at = now();
  delete from server_members where server_id = p_server and user_id = p_target;
  insert into audit_log (server_id, actor_id, actor_name, action, target_name, detail)
    values (p_server, auth.uid(), coalesce((select display_name from profiles where id = auth.uid()), 'user'), 'ban', coalesce(v_target_name, p_target::text), p_reason);
end;
$$;

create or replace function unban_member(p_server uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  select owner into v_owner from servers where id = p_server;
  if v_owner is null then raise exception 'server not found'; end if;
  if auth.uid() <> v_owner and (server_permissions(p_server, auth.uid()) & 16) = 0 then
    raise exception 'missing BAN_MEMBERS permission';
  end if;
  delete from server_bans where server_id = p_server and user_id = p_target;
  insert into audit_log (server_id, actor_id, actor_name, action, target_name)
    values (p_server, auth.uid(), coalesce((select display_name from profiles where id = auth.uid()), 'user'), 'unban', p_target::text);
end;
$$;

create or replace function timeout_member(p_server uuid, p_target uuid, p_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor_pos int;
  v_target_pos int;
  v_target_name text;
begin
  select owner into v_owner from servers where id = p_server;
  if v_owner is null then raise exception 'server not found'; end if;
  if p_target = v_owner then raise exception 'cannot timeout the owner'; end if;
  if p_target = auth.uid() then raise exception 'cannot timeout yourself'; end if;
  if auth.uid() <> v_owner then
    if (server_permissions(p_server, auth.uid()) & 16384) = 0 then raise exception 'missing TIMEOUT_MEMBERS permission'; end if;
    v_actor_pos := coalesce(top_role_position(p_server, auth.uid()), 999999);
    v_target_pos := coalesce(top_role_position(p_server, p_target), 999999);
    if v_actor_pos >= v_target_pos then raise exception 'cannot manage a member with an equal or higher role'; end if;
  end if;
  select member_name into v_target_name from server_members where server_id = p_server and user_id = p_target;
  update server_members set timeout_until = p_until where server_id = p_server and user_id = p_target;
  insert into audit_log (server_id, actor_id, actor_name, action, target_name, detail)
    values (p_server, auth.uid(), coalesce((select display_name from profiles where id = auth.uid()), 'user'),
      case when p_until is null then 'timeout_clear' else 'timeout' end, coalesce(v_target_name, p_target::text),
      case when p_until is null then null else 'до ' || to_char(p_until, 'DD.MM HH24:MI') end);
end;
$$;
