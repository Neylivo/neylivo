-- v1.265.0: право «Управление никами» (как Discord MANAGE_NICKNAMES) — модератор
-- или владелец может сменить ник ДРУГОГО участника на сервере. Раньше «Изменить
-- ник на сервере» (ServerView.tsx) работал только для своего аккаунта: RLS
-- sm_update_self (миграция 64_server_nickname.sql) пускает менять только свою
-- же строку server_members. Эта функция — обход RLS для админов, тот же приём,
-- что у kick_member/ban_member/timeout_member (34_permissions.sql/49_role_perms2.sql).
create or replace function set_member_nickname(p_server uuid, p_target uuid, p_nickname text, p_override boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor_pos int;
  v_target_pos int;
begin
  select owner into v_owner from servers where id = p_server;
  if v_owner is null then raise exception 'server not found'; end if;
  if auth.uid() <> v_owner and p_target <> auth.uid() then
    if (server_permissions(p_server, auth.uid()) & 131072) = 0 then raise exception 'missing MANAGE_NICKNAMES permission'; end if;
    v_actor_pos := coalesce(top_role_position(p_server, auth.uid()), 999999);
    v_target_pos := coalesce(top_role_position(p_server, p_target), 999999);
    if v_actor_pos >= v_target_pos then raise exception 'cannot manage a member with an equal or higher role'; end if;
  end if;
  update server_members set member_name = p_nickname, nickname_override = p_override
    where server_id = p_server and user_id = p_target;
end;
$$;
