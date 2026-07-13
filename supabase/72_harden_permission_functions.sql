-- v1.276.0: аудит ВСЕХ RLS-хелперов после находки в can_view_channel (71) —
-- искал тот же паттерн (функция читает таблицу, которую сама же охраняет
-- RLS-политикой, и не помечена security definer) по всем миграциям.
--
-- Активной рекурсии больше нигде не нашёл: is_member/is_dm_participant/
-- are_friends/can_dm/can_call уже были security definer с самого начала.
-- Но server_permissions()/top_role_position() (34_permissions.sql,
-- 49_role_perms2.sql) — НЕТ, хотя используются в points ровно так же (RLS-
-- политики messages/channels/reactions/server_invites/servers/audit_log).
-- Сейчас рекурсии от этого нет только по счастливой случайности: таблицы,
-- которые они читают (member_roles/server_roles/server_members/servers),
-- сами защищены политиками через is_member() (уже security definer, безопасно)
-- и НЕ вызывают server_permissions() обратно. Но это хрупко — стоит кому-то
-- позже завязать mr_read/roles_read/sm_read/servers_read на битовую проверку
-- прав (как уже сделано для mr_insert/mr_delete/servers_update), и получится
-- тот же class бага, что чинили в 71 — только найти будет так же больно.
-- Помечаем security definer превентивно, как и все остальные RLS-хелперы —
-- запросы внутри уже сами фильтруют по p_server/p_user, так что результат
-- не меняется, только перестаёт зависеть от RLS вызывающего.
create or replace function server_permissions(p_server uuid, p_user uuid)
returns bigint language sql security definer set search_path = public stable as $$
  select coalesce((select bit_or(sr.permissions) from member_roles mr join server_roles sr on sr.id = mr.role_id
                   where mr.server_id = p_server and mr.user_id = p_user), 0)
       | coalesce((select sr.permissions from server_members sm join server_roles sr on sr.id = sm.role_id
                   where sm.server_id = p_server and sm.user_id = p_user), 0)
       | coalesce((select base_permissions from servers where id = p_server), 0)
$$;

create or replace function top_role_position(p_server uuid, p_user uuid)
returns int language sql security definer set search_path = public stable as $$
  select min(pos) from (
    select sr.position as pos from member_roles mr join server_roles sr on sr.id = mr.role_id
      where mr.server_id = p_server and mr.user_id = p_user
    union all
    select sr.position from server_members sm join server_roles sr on sr.id = sm.role_id
      where sm.server_id = p_server and sm.user_id = p_user
  ) t
$$;
