-- 82: правила сервера стали настоящими (v1.322.0).
--
-- Что было. Во вкладке «Доступ» стоял переключатель «Правила сервера» со
-- списком правил и подписью «Прежде чем общаться на сервере и взаимодействовать
-- с другими его участниками, необходимо согласиться с правилами сервера».
-- Ни переключатель, ни сам список не читались нигде: правила можно было
-- написать, но никто их не видел и ни с чем не соглашался.
--
-- Стало. Пока участник не согласился, он не может ни писать, ни заводить
-- обсуждения, ни ставить реакции — то есть ровно «общаться и взаимодействовать»,
-- как и было обещано в подписи. Проверка стоит в базе, а не в интерфейсе:
-- показать экран с правилами и не пустить дальше — это защита от невнимательного,
-- а не от того, кто шлёт запрос мимо приложения.
--
-- Владельца сервера правила не держат: иначе он не смог бы их же и исправить.

alter table public.server_members
  add column if not exists rules_accepted_at timestamptz;

-- Уже вступившие считаются согласившимися: правил на сервере до сих пор не
-- существовало, и требовать согласия задним числом значило бы разом отрезать
-- всех от переписки, в которой они и так участвовали.
update public.server_members set rules_accepted_at = coalesce(rules_accepted_at, joined_at, now())
 where rules_accepted_at is null;

-- Согласие «протухает», когда владелец меняет правила: settings.rules_at — метка
-- времени последней правки, её ставит ServerSettings.tsx при сохранении. Без неё
-- можно было бы согласиться с пустым списком, а потом дописать в него что угодно
-- и считать, что все с этим согласны.
create or replace function public.server_rules_ok(p_server uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    -- Правила выключены — держать некого.
    when not coalesce((select (s.settings ->> 'rules_on')::boolean from public.servers s where s.id = p_server), false)
      then true
    -- Владелец: иначе он заперт своими же правилами и не может их изменить.
    when exists (select 1 from public.servers s where s.id = p_server and s.owner = p_user)
      then true
    else exists (
      select 1 from public.server_members sm
       where sm.server_id = p_server and sm.user_id = p_user
         and sm.rules_accepted_at is not null
         and sm.rules_accepted_at >= coalesce(
               (select (s.settings ->> 'rules_at')::timestamptz from public.servers s where s.id = p_server),
               '-infinity'::timestamptz)
    )
  end;
$$;

revoke all on function public.server_rules_ok(uuid, uuid) from public;
grant execute on function public.server_rules_ok(uuid, uuid) to authenticated;

-- Дата согласия ставится базой, а не присылается клиентом: иначе участник
-- поставил бы себе 2099 год и больше никогда не увидел бы изменённых правил.
create or replace function public.enforce_member_self_edit()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.user_id then
    if (new.role is distinct from old.role
        or new.role_id is distinct from old.role_id
        or new.timeout_until is distinct from old.timeout_until
        or new.joined_at is distinct from old.joined_at
        or new.user_id is distinct from old.user_id
        or new.server_id is distinct from old.server_id)
    then
      raise exception 'self-edit is limited to member_name/nickname_override/rules_accepted_at';
    end if;
    if new.rules_accepted_at is distinct from old.rules_accepted_at then
      new.rules_accepted_at := now();
    end if;
  end if;
  return new;
end;
$$;

-- Тот же текст, что в 81_forums.sql, плюс последняя строка.
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages for insert with check (
  author = auth.uid() and exists (
    select 1 from public.channels c where c.id = messages.channel_id and is_member(c.server_id)
    and not exists (select 1 from public.server_members sm where sm.server_id = c.server_id and sm.user_id = auth.uid()
                     and sm.timeout_until is not null and sm.timeout_until > now())
    and (messages.attach_url is null or exists (
      select 1 from public.servers s where s.id = c.server_id and (s.owner = auth.uid() or (public.server_permissions(s.id, auth.uid()) & 8192) <> 0)
    ))
    and public.server_rules_ok(c.server_id, auth.uid())
  )
  and public.can_view_channel(messages.channel_id, auth.uid())
  and public.channel_can_send(messages.channel_id, auth.uid())
  and (messages.thread_id is null or public.thread_can_post(messages.thread_id, auth.uid()))
);

-- Тот же текст, что в 81_forums.sql, плюс последняя строка.
drop policy if exists "threads_insert" on public.threads;
create policy "threads_insert" on public.threads for insert to authenticated
  with check (
    is_member(server_id)
    and created_by = auth.uid()
    and public.can_view_channel(channel_id, auth.uid())
    and public.channel_can_send(channel_id, auth.uid())
    and public.server_rules_ok(server_id, auth.uid())
  );

-- Тот же текст, что в 49_role_perms2.sql, плюс последняя строка.
drop policy if exists "rx_insert" on public.reactions;
create policy "rx_insert" on public.reactions for insert with check (
  user_id = auth.uid() and exists (
    select 1 from public.messages m join public.channels c on c.id = m.channel_id
    where m.id = reactions.message_id and is_member(c.server_id)
    and not exists (select 1 from public.server_members sm where sm.server_id = c.server_id and sm.user_id = auth.uid()
                     and sm.timeout_until is not null and sm.timeout_until > now())
    and exists (select 1 from public.servers s where s.id = c.server_id and (s.owner = auth.uid() or (public.server_permissions(s.id, auth.uid()) & 4096) <> 0))
    and public.server_rules_ok(c.server_id, auth.uid())
  )
);
