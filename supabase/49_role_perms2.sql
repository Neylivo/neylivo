-- 49_role_perms2.sql — расширенные права ролей (v1.191.0), 10 новых битов поверх
-- 6 существующих из 34_permissions.sql. Держим в точности так же на клиенте
-- в src/lib/permissions.ts:
--   64     VIEW_AUDIT_LOG    — вкладка «Журнал аудита»
--   128    MANAGE_EMOJI      — вкладки «Эмодзи»/«Стикеры»
--   256    MANAGE_EVENTS     — создание событий (раньше не имело своего бита)
--   512    MANAGE_WEBHOOKS   — вкладка «Боты»
--   1024   CREATE_INVITE     — генерация приглашений (раньше мог любой участник)
--   2048   MENTION_EVERYONE  — @everyone реально пингует (без бита — просто текст)
--   4096   ADD_REACTIONS     — ставить реакции
--   8192   ATTACH_FILES      — прикреплять файлы/картинки
--   16384  TIMEOUT_MEMBERS   — новая модерация: временный тайм-аут
--   32768  MANAGE_AUTOMOD    — вкладка «Automod» отдельно от MANAGE_SERVER
--
-- Заодно чиним реальный существующий баг: servers_update (18_role_perms.sql) и
-- mr_insert/mr_delete (25_member_roles.sql) до сих пор проверяют старый булев
-- флаг server_roles.manage, а не битовую маску permissions — роль с выданным
-- через UI MANAGE_SERVER/MANAGE_ROLES проходила клиентскую проверку, но
-- падала на RLS. Переписываем обе политики на server_permissions() & BIT,
-- как уже сделано для messages/channels в 34_permissions.sql.

drop policy if exists "servers_update" on servers;
create policy "servers_update" on servers for update using (
  auth.uid() = owner or (server_permissions(id, auth.uid()) & 1) <> 0
);

drop policy if exists "mr_insert" on member_roles;
create policy "mr_insert" on member_roles for insert with check (
  exists (select 1 from servers s where s.id = server_id and s.owner = auth.uid())
  or (server_permissions(server_id, auth.uid()) & 2) <> 0
);
drop policy if exists "mr_delete" on member_roles;
create policy "mr_delete" on member_roles for delete using (
  exists (select 1 from servers s where s.id = member_roles.server_id and s.owner = auth.uid())
  or (server_permissions(member_roles.server_id, auth.uid()) & 2) <> 0
);

-- ВАЖНО: CREATE_INVITE/MENTION_EVERYONE/ADD_REACTIONS/ATTACH_FILES сейчас
-- разрешены ВООБЩЕ ВСЕМ участникам без единого бита (система прав — чисто
-- аддитивная, роли ролям). Если требовать эти биты как обычные права ролей,
-- у любого участника БЕЗ явно назначенной роли (обычное дело — большинство
-- рядовых участников) эти действия просто пропадут — серьёзный регресс. У
-- Discord эта проблема решена ролью @everyone, которая есть у всех по
-- умолчанию; в Ponoi такой роли нет. Заводим её эквивалент — server-wide
-- базовые права, которые server_permissions() всегда добавляет поверх ролей.
alter table servers add column if not exists base_permissions bigint not null default 15872; -- MENTION_EVERYONE(2048)|ADD_REACTIONS(4096)|ATTACH_FILES(8192)|CREATE_INVITE(1024)

create or replace function server_permissions(p_server uuid, p_user uuid)
returns bigint language sql stable as $$
  select coalesce((select bit_or(sr.permissions) from member_roles mr join server_roles sr on sr.id = mr.role_id
                   where mr.server_id = p_server and mr.user_id = p_user), 0)
       | coalesce((select sr.permissions from server_members sm join server_roles sr on sr.id = sm.role_id
                   where sm.server_id = p_server and sm.user_id = p_user), 0)
       | coalesce((select base_permissions from servers where id = p_server), 0)
$$;

-- Тайм-аут: временно не может писать/реагировать, но остаётся на сервере (в
-- отличие от кика/бана). p_until = null снимает тайм-аут досрочно.
alter table server_members add column if not exists timeout_until timestamptz;

create or replace function timeout_member(p_server uuid, p_target uuid, p_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor_pos int;
  v_target_pos int;
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
  update server_members set timeout_until = p_until where server_id = p_server and user_id = p_target;
end;
$$;

-- messages_insert: тайм-аут блокирует отправку; вложения требуют ATTACH_FILES
-- (только если сообщение реально несёт attach_url — текст без вложения не трогаем).
drop policy if exists "messages_insert" on messages;
create policy "messages_insert" on messages for insert with check (
  author = auth.uid() and exists (
    select 1 from channels c where c.id = messages.channel_id and is_member(c.server_id)
    and not exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = auth.uid()
                     and sm.timeout_until is not null and sm.timeout_until > now())
    and (messages.attach_url is null or exists (
      select 1 from servers s where s.id = c.server_id and (s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 8192) <> 0)
    ))
  )
);

-- rx_insert: тайм-аут блокирует реакции; ADD_REACTIONS — обычное право (владелец в обход).
drop policy if exists "rx_insert" on reactions;
create policy "rx_insert" on reactions for insert with check (
  user_id = auth.uid() and exists (
    select 1 from messages m join channels c on c.id = m.channel_id
    where m.id = reactions.message_id and is_member(c.server_id)
    and not exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = auth.uid()
                     and sm.timeout_until is not null and sm.timeout_until > now())
    and exists (select 1 from servers s where s.id = c.server_id and (s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 4096) <> 0))
  )
);

-- si_insert: CREATE_INVITE (тоже в base_permissions по умолчанию, см. выше).
drop policy if exists "si_insert" on server_invites;
create policy "si_insert" on server_invites for insert with check (
  is_member(server_id) and exists (select 1 from servers s where s.id = server_id and (s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 1024) <> 0))
);
