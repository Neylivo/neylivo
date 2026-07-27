-- 78: канал только для чтения (v1.316.0).
--
-- Что было. В настройках канала есть переключатели прав для @everyone, и рядом с
-- ними честно висело предупреждение: «сохраняются, но ни на что не влияют».
-- Из шести переключателей по-настоящему осмыслен один — запрет отправлять
-- сообщения: это канал объявлений, самый частый случай в Discord. Остальные либо
-- повторяли уже работающий переключатель приватности канала, либо описывали
-- понятия, которых в этом приложении нет (вебхуки).
--
-- Здесь запрет становится настоящим — то есть правилом базы, а не спрятанной
-- кнопкой. Прятать поле ввода на клиенте недостаточно: отправить сообщение можно
-- и напрямую, минуя интерфейс.
--
-- Кто пишет в закрытый канал: владелец сервера и те, кому выдано управление
-- сообщениями или каналами. Так же, как в Discord: объявления пишут те, кто
-- отвечает за сервер.

create or replace function public.channel_can_send(p_channel uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    -- Переключатель не тронут или стоит не в «запретить» — пишут все участники.
    when coalesce((select c.settings -> 'perms' ->> 'send' from public.channels c where c.id = p_channel), 'default') <> 'deny'
      then true
    else exists (
      select 1 from public.channels c
      join public.servers s on s.id = c.server_id
      where c.id = p_channel
        and (
          s.owner = p_user
          -- 32 = управление сообщениями, 4 = управление каналами (см. PERM в src/lib/permissions.ts)
          or (public.server_permissions(s.id, p_user) & 32) <> 0
          or (public.server_permissions(s.id, p_user) & 4) <> 0
        )
    )
  end;
$$;

revoke all on function public.channel_can_send(uuid, uuid) from public;
grant execute on function public.channel_can_send(uuid, uuid) to authenticated;

-- Тот же текст, что в 69_channel_privacy.sql, плюс проверка запрета на отправку.
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages for insert with check (
  author = auth.uid() and exists (
    select 1 from public.channels c where c.id = messages.channel_id and is_member(c.server_id)
    and not exists (select 1 from public.server_members sm where sm.server_id = c.server_id and sm.user_id = auth.uid()
                     and sm.timeout_until is not null and sm.timeout_until > now())
    and (messages.attach_url is null or exists (
      select 1 from public.servers s where s.id = c.server_id and (s.owner = auth.uid() or (public.server_permissions(s.id, auth.uid()) & 8192) <> 0)
    ))
  )
  and public.can_view_channel(messages.channel_id, auth.uid())
  and public.channel_can_send(messages.channel_id, auth.uid())
);
