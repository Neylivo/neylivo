-- 86: «X присоединился к серверу» (v1.329.0).
--
-- ЗАЧЕМ. В тихом Discord-сервере всё равно есть жизнь: канал заполняют строчки
-- о вступлениях. У NeyLivo системные сообщения были только про звонки, закрепы,
-- приглашения и сборки Minecraft, поэтому свежий канал выглядел совершенно
-- пустым — это и было главной претензией владельца к «ощущению».
--
-- Заодно это делает настоящими две настройки, которые до сих пор сохранялись и
-- не читались нигде (см. вкладку «Обзор» в настройках сервера):
--   settings.sys_channel  — в какой канал слать системные сообщения;
--   settings.sys_welcome  — слать ли приветствие вообще (по умолчанию да).
--
-- ПОЧЕМУ В БАЗЕ. Вступление происходит внутри redeem_invite (54) и
-- join_public_server (84) — обе security definer. Если бы строчку писал клиент
-- после вступления, её не было бы при вступлении с другого устройства, при
-- обрыве связи и вообще всегда, когда клиент решил не писать.
--
-- Формат содержимого — тот же невидимый маркер, что у остальных системных
-- сообщений (src/lib/sysmsg.ts): ⁣sys:join:⁣
-- Пишем от лица вступившего, поэтому имя в ленте берётся из author_name.

create or replace function public.post_join_message(p_server uuid, p_user uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_channel uuid;
begin
  select s.settings into v_settings from public.servers s where s.id = p_server;

  -- Выключено владельцем — молчим. Ключа нет вовсе — считаем, что включено:
  -- сервер, который никто не настраивал, должен вести себя как в Discord.
  if coalesce((v_settings ->> 'sys_welcome')::boolean, true) = false then return; end if;

  -- Канал из настроек, если он указан и всё ещё существует на этом сервере.
  select c.id into v_channel from public.channels c
   where c.server_id = p_server
     and c.id = nullif(v_settings ->> 'sys_channel', '')::uuid;

  -- Не указан или удалён — берём самый первый текстовый канал сервера, как это
  -- делает Discord со своим «системным каналом» по умолчанию. Приватные и
  -- голосовые пропускаем: в приватный вступивший может не иметь доступа, а в
  -- голосовом ленты нет вовсе.
  if v_channel is null then
    select c.id into v_channel from public.channels c
     where c.server_id = p_server
       and coalesce(c.kind, 'text') = 'text'
       and not coalesce((c.settings ->> 'private')::boolean, false)
     order by c.name limit 1;
  end if;

  if v_channel is null then return; end if;

  insert into public.messages (channel_id, author, author_name, content)
    values (v_channel, p_user, coalesce(nullif(p_name, ''), 'Участник'), chr(8291) || 'sys:join:' || chr(8291));
exception
  -- Приветствие — украшение, а не смысл вступления. Если оно почему-то не
  -- записалось, человек всё равно должен оказаться на сервере.
  when others then return;
end;
$$;

revoke all on function public.post_join_message(uuid, uuid, text) from public;

-- Тот же текст, что в 54_security_hardening.sql, плюс последняя строка.
create or replace function public.redeem_invite(p_code text, p_member_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_server_id uuid;
  v_paused boolean;
  v_new boolean := false;
begin
  select server_id into v_server_id from server_invites where code = p_code;
  if v_server_id is null then raise exception 'invite_not_found'; end if;
  select coalesce((settings->>'invites_paused')::boolean, false) into v_paused from servers where id = v_server_id;
  if v_paused then raise exception 'invites_paused'; end if;
  if exists (select 1 from server_bans b where b.server_id = v_server_id and b.user_id = auth.uid()) then
    raise exception 'banned';
  end if;
  -- v1.329.0: отличаем «вступил впервые» от «перешёл по ссылке, уже состоя» —
  -- иначе строчка о вступлении появлялась бы при каждом клике по приглашению.
  v_new := not exists (select 1 from server_members m where m.server_id = v_server_id and m.user_id = auth.uid());
  insert into server_members (server_id, user_id, member_name, role)
    values (v_server_id, auth.uid(), p_member_name, 'member')
    on conflict (server_id, user_id) do nothing;
  if v_new then perform public.post_join_message(v_server_id, auth.uid(), p_member_name); end if;
  return v_server_id;
end;
$$;
revoke all on function public.redeem_invite(text, text) from public;
grant execute on function public.redeem_invite(text, text) to authenticated;

-- Тот же текст, что в 84_public_servers.sql, плюс последняя строка.
create or replace function public.join_public_server(p_server uuid, p_member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_public boolean;
  v_paused boolean;
  v_new boolean := false;
begin
  select true,
         coalesce((s.settings ->> 'public')::boolean, false),
         coalesce((s.settings ->> 'invites_paused')::boolean, false)
    into v_exists, v_public, v_paused
    from public.servers s where s.id = p_server;

  if v_exists is null then raise exception 'server_not_found'; end if;
  if not v_public then raise exception 'server_not_found'; end if;
  if v_paused then raise exception 'invites_paused'; end if;
  if exists (select 1 from public.server_bans b where b.server_id = p_server and b.user_id = auth.uid()) then
    raise exception 'banned';
  end if;

  v_new := not exists (select 1 from public.server_members m where m.server_id = p_server and m.user_id = auth.uid());
  insert into public.server_members (server_id, user_id, member_name, role)
    values (p_server, auth.uid(), p_member_name, 'member')
    on conflict (server_id, user_id) do nothing;
  if v_new then perform public.post_join_message(p_server, auth.uid(), p_member_name); end if;
  return p_server;
end;
$$;

revoke all on function public.join_public_server(uuid, text) from public;
grant execute on function public.join_public_server(uuid, text) to authenticated;
