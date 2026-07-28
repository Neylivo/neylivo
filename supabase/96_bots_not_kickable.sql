-- v1.356.0: бота не выгоняют и не банят — его убирают.
--
-- Что было не так. Бот в server_members — обычная строка, и kick_member/ban_member
-- обходились с ним как с человеком. Кикнутый бот исчезал с сервера, но его
-- приложение, команды и владелец оставались; а бан заводил на бота строку в
-- server_bans, из-за которой владелец потом не мог поставить своего же бота
-- обратно, не понимая почему.
--
-- Убирают бота отдельной функцией remove_bot_from_server (миграция 95) — по праву
-- «Управление ботами», а не «Кик» или «Бан». Это разные вещи: модератор чата и
-- тот, кто заведует ботами, обычно разные люди.
--
-- Проверку ставим в базе, а не только в интерфейсе: кнопку легко не показать, но
-- вызвать функцию напрямую может кто угодно.
--
-- Тела функций взяты из 68_audit_log.sql (там они последний раз переопределялись)
-- и отличаются от них ровно одной проверкой — иначе эта миграция незаметно
-- отменила бы запись в журнал сервера.

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
  if exists (select 1 from bot_apps where bot_user_id = p_target) then raise exception 'target_is_bot'; end if;
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
  if exists (select 1 from bot_apps where bot_user_id = p_target) then raise exception 'target_is_bot'; end if;
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

-- Тайм-аут боту тоже бессмыслен: он и так пишет, только когда его позвали, а
-- «замолчал и непонятно почему» — ровно то, из-за чего бот кажется сломанным.
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
  if exists (select 1 from bot_apps where bot_user_id = p_target) then raise exception 'target_is_bot'; end if;
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
