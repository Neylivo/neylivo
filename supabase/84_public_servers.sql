-- 84: чужие серверы перестали быть видны всем подряд (v1.324.0).
--
-- ЧТО БЫЛО. Миграция 76 («чтение требует входа», v1.313.0) переписывала правило
-- чтения серверов, чтобы добавить `to authenticated`. Вместе с этим она заменила
-- само условие: было `is_member(id) or owner = auth.uid()` (миграция 03), стало
-- `using (true)`. То есть любой вошедший читал ВСЕ строки таблицы servers —
-- названия, значки и настройки каждого сервера, включая те, куда его никто не
-- звал. Это ровно тот же класс ошибки, который сама 76 и чинила, только внесённый
-- ею же и в обратную сторону.
--
-- Видно это было невооружённым глазом: «Путешествие по серверам» показывало
-- вперемешку чужие и служебные серверы (в том числе созданные тестовыми
-- учётными записями вида chtest…), а myServers() в src/lib/servers.ts вообще
-- выбирает servers без всякого условия — он полагался на то, что правило чтения
-- само оставит только твои.
--
-- ЧТО СТАЛО. Сервер виден, если он твой, если ты в нём состоишь — или если
-- владелец сам сделал его публичным. Публичность — настоящая настройка
-- («Доступ» в настройках сервера), а не признак по умолчанию.

drop policy if exists "servers_read" on public.servers;
create policy "servers_read" on public.servers for select to authenticated using (
  owner = auth.uid()
  or is_member(id)
  or coalesce((settings ->> 'public')::boolean, false)
);

-- Вступление в публичный сервер без приглашения.
--
-- Раньше это делал прямой insert в server_members (joinServerDirect в
-- src/lib/servers.ts). С миграции 54 такой insert разрешён ТОЛЬКО владельцу при
-- создании своего сервера, поэтому кнопка «Присоединиться» в «Путешествии по
-- серверам» с тех пор не работала вообще ни разу — она всегда упиралась в отказ
-- правила доступа. Здесь она снова начинает работать, но только там, где владелец
-- это разрешил.
--
-- Функция security definer по той же причине, что и redeem_invite (54): клиенту
-- нельзя доверить проверку «публичный ли сервер, не забанен ли ты, не
-- приостановлены ли приглашения» — он бы просто не стал её делать.
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
begin
  select true,
         coalesce((s.settings ->> 'public')::boolean, false),
         coalesce((s.settings ->> 'invites_paused')::boolean, false)
    into v_exists, v_public, v_paused
    from public.servers s where s.id = p_server;

  if v_exists is null then raise exception 'server_not_found'; end if;
  -- Не публичный — отвечаем тем же текстом, что и на несуществующий: иначе по
  -- разнице ответов можно было бы перебором id выяснять, какие приватные серверы
  -- существуют.
  if not v_public then raise exception 'server_not_found'; end if;
  if v_paused then raise exception 'invites_paused'; end if;
  if exists (select 1 from public.server_bans b where b.server_id = p_server and b.user_id = auth.uid()) then
    raise exception 'banned';
  end if;

  insert into public.server_members (server_id, user_id, member_name, role)
    values (p_server, auth.uid(), p_member_name, 'member')
    on conflict (server_id, user_id) do nothing;
  return p_server;
end;
$$;

revoke all on function public.join_public_server(uuid, text) from public;
grant execute on function public.join_public_server(uuid, text) to authenticated;
