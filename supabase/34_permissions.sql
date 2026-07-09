-- 34_permissions.sql — полноценная система прав ролей, как в Discord (v1.156.0)
-- Раньше был единственный флаг server_roles.manage ("Управление сервером").
-- Теперь — битовая маска прав (permissions bigint), кик/бан участников (раньше
-- не существовали вовсе), «Управление сообщениями» для чужих сообщений, и
-- иерархия ролей (нельзя кикнуть/забанить участника с ролью выше или равной своей).
-- Права переопределений по конкретным ролям/участникам НА УРОВНЕ КАНАЛА
-- (per-channel overwrites) — сознательно НЕ в этой миграции, это отдельная
-- большая задача (channels.settings.perms остаётся как есть, просто нигде не
-- проверяется рантаймом — как и было).
--
-- Биты прав (степени двойки, держим в точности так же на клиенте в
-- src/lib/permissions.ts):
--   1   MANAGE_SERVER     — открывать «Настройки сервера»
--   2   MANAGE_ROLES      — создавать/менять/удалять роли, назначать их участникам
--   4   MANAGE_CHANNELS   — создавать/менять/удалять каналы и категории
--   8   KICK_MEMBERS      — кикать участников
--   16  BAN_MEMBERS       — банить участников
--   32  MANAGE_MESSAGES   — удалять/закреплять чужие сообщения

alter table server_roles add column if not exists permissions bigint not null default 0;

-- Переносим старый флаг manage — раньше он открывал доступ и к серверу, и к
-- каналам, и к ролям разом, так что при переезде роль получает все три бита
-- (плюс модерацию), чтобы никто не потерял то, что уже мог делать.
update server_roles set permissions = permissions | 63 where manage = true and permissions = 0;

-- Баны сервера — раньше такой таблицы не было вообще (кика/бана не существовало).
create table if not exists server_bans (
  server_id uuid not null references servers on delete cascade,
  user_id uuid not null,
  banned_by uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
alter table server_bans enable row level security;

drop policy if exists "server_bans_read" on server_bans;
create policy "server_bans_read" on server_bans for select to authenticated
  using (is_member(server_id) or exists (select 1 from servers s where s.id = server_bans.server_id and s.owner = auth.uid()));
-- Вставка/удаление банов — только через security-definer функции ниже (сами проверяют права).

-- Забаненный не может снова вступить на сервер.
drop policy if exists "sm_insert_not_banned" on server_members;
create policy "sm_insert_not_banned" on server_members for insert to authenticated
  with check (not exists (select 1 from server_bans b where b.server_id = server_members.server_id and b.user_id = auth.uid()));

-- Суммарная маска прав пользователя на сервере (объединение прав всех его
-- ролей — и через новую member_roles, и через старое одиночное role_id, чтобы
-- не потерять права тех, у кого роль всё ещё назначена по-старому).
create or replace function server_permissions(p_server uuid, p_user uuid)
returns bigint language sql stable as $$
  select coalesce((select bit_or(sr.permissions) from member_roles mr join server_roles sr on sr.id = mr.role_id
                   where mr.server_id = p_server and mr.user_id = p_user), 0)
       | coalesce((select sr.permissions from server_members sm join server_roles sr on sr.id = sm.role_id
                   where sm.server_id = p_server and sm.user_id = p_user), 0)
$$;

-- Позиция самой старшей роли пользователя (меньше position = старше роль, как
-- в списке ролей сервера). Нет ролей — считается "ниже всех" (большое число).
create or replace function top_role_position(p_server uuid, p_user uuid)
returns int language sql stable as $$
  select min(pos) from (
    select sr.position as pos from member_roles mr join server_roles sr on sr.id = mr.role_id
      where mr.server_id = p_server and mr.user_id = p_user
    union all
    select sr.position from server_members sm join server_roles sr on sr.id = sm.role_id
      where sm.server_id = p_server and sm.user_id = p_user
  ) t
$$;

-- Кикнуть участника: owner — всегда; иначе нужен бит KICK_MEMBERS И старшая
-- роль строго выше (меньше position), чем у жертвы. Владельца и себя кикнуть нельзя.
create or replace function kick_member(p_server uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor_pos int;
  v_target_pos int;
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
  delete from server_members where server_id = p_server and user_id = p_target;
end;
$$;

-- Забанить: та же проверка + запись в server_bans + кик (если ещё на сервере).
create or replace function ban_member(p_server uuid, p_target uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor_pos int;
  v_target_pos int;
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
  insert into server_bans (server_id, user_id, banned_by, reason) values (p_server, p_target, auth.uid(), p_reason)
    on conflict (server_id, user_id) do update set banned_by = excluded.banned_by, reason = excluded.reason, created_at = now();
  delete from server_members where server_id = p_server and user_id = p_target;
end;
$$;

-- Разбанить: owner или BAN_MEMBERS.
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
end;
$$;

-- «Управление сообщениями»: удалять/закреплять чужие сообщения — не только автору.
drop policy if exists "messages_delete" on messages;
create policy "messages_delete" on messages for delete to authenticated using (
  author = auth.uid()
  or exists (
    select 1 from channels c join servers s on s.id = c.server_id
    where c.id = messages.channel_id and (s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 32) <> 0)
  )
);

drop policy if exists "messages_update_pin" on messages;
create policy "messages_update_pin" on messages for update to authenticated using (
  author = auth.uid()
  or exists (
    select 1 from channels c join servers s on s.id = c.server_id
    where c.id = messages.channel_id and (s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 32) <> 0)
  )
);

-- MANAGE_CHANNELS теперь может и удалять канал, не только owner (миграция 29
-- разрешала удаление жёстко только владельцу).
drop policy if exists "channels_delete" on channels;
create policy "channels_delete" on channels for delete to authenticated using (
  exists (select 1 from servers s where s.id = channels.server_id and (
    s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 4) <> 0
  ))
);

-- channels_update — было завязано только на старое одиночное server_members.role_id
-- (пропускало права, назначенные через member_roles); теперь через общую функцию.
drop policy if exists "channels_update" on channels;
create policy "channels_update" on channels for update to authenticated using (
  exists (select 1 from servers s where s.id = channels.server_id and (
    s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 4) <> 0
  ))
);
