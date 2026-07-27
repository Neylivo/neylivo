-- 83: уровень проверки участников заработал (v1.322.0).
--
-- Что было. Во вкладке «Настройка безопасности» стоял «Уровень проверки» с пятью
-- ступенями и подписью «Участники сервера должны соответствовать указанным
-- критериям, чтобы писать в текстовые каналы». Значение сохранялось в настройки
-- сервера и не читалось нигде: владелец ставил «Наивысший» и получал ровно ту же
-- открытую площадку, что и раньше.
--
-- Стало. Ступень действительно решает, может ли участник писать, и решает это
-- база. Ступени те же, что были написаны в интерфейсе:
--   0 Отсутствует — без ограничений;
--   1 Низкий      — подтверждённая почта;
--   2 Средний     — учётной записи больше 5 минут;
--   3 Высокий     — на этом сервере больше 10 минут;
--   4 Наивысший   — подтверждённый номер телефона.
--
-- Ступени накопительные, как в Discord: «Высокий» включает в себя требования
-- «Среднего» и «Низкого».
--
-- Про «Наивысший» отдельно: колонка phone_confirmed_at настоящая, но вход по
-- телефону в проекте не настроен, поэтому подтверждённого номера нет ни у кого и
-- эта ступень закроет письмо всем, кроме владельца и тех, у кого есть роль. Так
-- она и описана в интерфейсе — не обещаем того, чего нет.
--
-- Кого ступень не касается (как и в Discord): владельца сервера и всех, у кого
-- есть хоть одна назначенная роль — «данное условие не действует, если у
-- участника есть назначенная роль» было написано в интерфейсе с самого начала.

create or replace function public.server_verification_ok(p_server uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_level int;
  v_owner uuid;
  v_joined timestamptz;
  v_created timestamptz;
  v_email_ok boolean;
  v_phone_ok boolean;
begin
  select coalesce((s.settings ->> 'verification')::int, 0), s.owner
    into v_level, v_owner
    from public.servers s where s.id = p_server;

  if v_level is null or v_level <= 0 then return true; end if;
  if v_owner = p_user then return true; end if;

  -- Роль снимает ограничение — ровно то, что обещано в подписи настройки.
  if exists (select 1 from public.member_roles mr where mr.server_id = p_server and mr.user_id = p_user)
     or exists (select 1 from public.server_members sm
                 where sm.server_id = p_server and sm.user_id = p_user and sm.role_id is not null)
  then return true; end if;

  select sm.joined_at into v_joined
    from public.server_members sm where sm.server_id = p_server and sm.user_id = p_user;
  select u.created_at, u.email_confirmed_at is not null, u.phone_confirmed_at is not null
    into v_created, v_email_ok, v_phone_ok
    from auth.users u where u.id = p_user;

  -- Ступени накопительные: каждая следующая добавляет требование к предыдущим.
  if v_level >= 1 and not coalesce(v_email_ok, false) then return false; end if;
  if v_level >= 2 and coalesce(v_created, now()) > now() - interval '5 minutes' then return false; end if;
  if v_level >= 3 and coalesce(v_joined, now()) > now() - interval '10 minutes' then return false; end if;
  if v_level >= 4 and not coalesce(v_phone_ok, false) then return false; end if;
  return true;
end;
$$;

revoke all on function public.server_verification_ok(uuid, uuid) from public;
grant execute on function public.server_verification_ok(uuid, uuid) to authenticated;

-- Тот же текст, что в 82_server_rules.sql, плюс последняя строка внутри exists.
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
    and public.server_verification_ok(c.server_id, auth.uid())
  )
  and public.can_view_channel(messages.channel_id, auth.uid())
  and public.channel_can_send(messages.channel_id, auth.uid())
  and (messages.thread_id is null or public.thread_can_post(messages.thread_id, auth.uid()))
);
