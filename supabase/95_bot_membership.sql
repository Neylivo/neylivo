-- v1.355.0: убрать бота с сервера — вправе владелец и «Управление ботами».
--
-- Что было не так. Кнопка «Убрать бота с сервера» удаляла строку из
-- server_members прямым запросом с клиента. Но правило sm_delete (77) пускает
-- только к СВОЕЙ строке (user_id = auth.uid()), а строка бота принадлежит боту —
-- запрос не падал с ошибкой, он просто не находил ни одной строки и «успешно»
-- удалял ноль. Кнопка была, нажималась, ничего не делала.
--
-- Почему не расширить sm_delete. Правило «удаляй только себя» держит на месте всё
-- остальное: иначе любой участник вычистил бы чужие членства. Право нужно ровно
-- на ботов и ровно у тех, кому его выдали, — это отдельная функция с проверкой.
--
-- Добавление бота живёт в Edge Function bot-add-to-server (ей нужен service role,
-- чтобы вставить чужой user_id); там та же проверка права.

create or replace function public.remove_bot_from_server(p_bot_user uuid, p_server uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select owner into v_owner from servers where id = p_server;
  if v_owner is null then raise exception 'server_not_found'; end if;

  -- 512 = MANAGE_WEBHOOKS, в интерфейсе «Управление ботами».
  if v_owner <> auth.uid() and (server_permissions(p_server, auth.uid()) & 512) = 0 then
    raise exception 'missing_manage_bots';
  end if;

  -- Только бот. Людей убирают kick_member/ban_member — там своё право, и подменять
  -- одно другим нельзя: иначе «Управление ботами» стало бы способом выгонять живых.
  if not exists (select 1 from bot_apps where bot_user_id = p_bot_user) then
    raise exception 'not_a_bot';
  end if;

  delete from server_members where server_id = p_server and user_id = p_bot_user;
end;
$$;

revoke all on function public.remove_bot_from_server(uuid, uuid) from public;
grant execute on function public.remove_bot_from_server(uuid, uuid) to authenticated;
