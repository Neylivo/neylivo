-- 58_dm_privacy.sql — гибкая приватность личных сообщений и звонков (v1.230.0),
-- как в Discord: не-друг может написать, но не позвонить (значения по умолчанию
-- ниже) — и это дополнительно настраивается гибче, чем в самом Discord: можно
-- запретить звонки всем, кроме избранных (закреплённых) друзей, отключить
-- сообщения от кого угодно и т.д.
--
-- Заодно чинит регрессию из 57_fix_group_dm_rls_recursion.sql — та политика
-- "dm_insert" случайно потеряла проверку блокировки (blocked_users) из
-- 48_block.sql при переписывании под группы. Восстановлена ниже.

alter table public.profiles add column if not exists dm_message_privacy text not null default 'all';
alter table public.profiles drop constraint if exists profiles_dm_message_privacy_check;
alter table public.profiles add constraint profiles_dm_message_privacy_check
  check (dm_message_privacy in ('all', 'friends', 'none'));

alter table public.profiles add column if not exists dm_call_privacy text not null default 'friends';
alter table public.profiles drop constraint if exists profiles_dm_call_privacy_check;
alter table public.profiles add constraint profiles_dm_call_privacy_check
  check (dm_call_privacy in ('all', 'friends', 'favorites', 'none'));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.friend_requests fr where fr.status = 'accepted'
    and ((fr.from_user = a and fr.to_user = b) or (fr.from_user = b and fr.to_user = a))
  );
$$;
revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

-- Может ли p_sender написать p_recipient — по настройке dm_message_privacy
-- получателя. Используется и в RLS (dt_insert/dm_insert), и клиентом заранее
-- (проверка перед открытием диалога, чтобы сразу показать понятную причину).
create or replace function public.can_dm(p_sender uuid, p_recipient uuid) returns boolean
language plpgsql security definer set search_path = public stable as $$
declare v_privacy text;
begin
  if p_sender <> auth.uid() then raise exception 'not_allowed'; end if;
  if p_sender = p_recipient then return true; end if;
  select dm_message_privacy into v_privacy from public.profiles where id = p_recipient;
  v_privacy := coalesce(v_privacy, 'all');
  if v_privacy = 'all' then return true; end if;
  if v_privacy = 'none' then return false; end if;
  return public.are_friends(p_sender, p_recipient);
end;
$$;
revoke all on function public.can_dm(uuid, uuid) from public;
grant execute on function public.can_dm(uuid, uuid) to authenticated;

-- Может ли текущий пользователь позвонить p_target — по настройке dm_call_privacy
-- цели (all/friends/favorites/none). "favorites" — цель закрепила звонящего у себя
-- в списке ЛС (user_prefs.dm_pinned), это ЕЁ собственный выбор кто ей особо важен,
-- а не просто дружба. Используется клиентом перед звонком (см. livekit-token —
-- там та же логика продублирована на TS, потому что Edge Function пользуется
-- сервисным ключом и не имеет auth.uid()).
create or replace function public.can_call(p_target uuid) returns boolean
language plpgsql security definer set search_path = public stable as $$
declare v_privacy text; v_friend boolean;
begin
  if p_target = auth.uid() then return true; end if;
  select dm_call_privacy into v_privacy from public.profiles where id = p_target;
  v_privacy := coalesce(v_privacy, 'friends');
  if v_privacy = 'all' then return true; end if;
  if v_privacy = 'none' then return false; end if;
  v_friend := public.are_friends(auth.uid(), p_target);
  if v_privacy = 'friends' then return v_friend; end if;
  if v_privacy = 'favorites' then
    return v_friend and exists (
      select 1 from public.user_prefs up, jsonb_array_elements_text(up.dm_pinned) pinned_id
      where up.user_id = p_target and pinned_id = auth.uid()::text
    );
  end if;
  return false;
end;
$$;
revoke all on function public.can_call(uuid) from public;
grant execute on function public.can_call(uuid) to authenticated;

-- Создать диалог 1-в-1 можно только если получатель разрешает сообщения от отправителя.
drop policy if exists "dt_insert" on public.dm_threads;
create policy "dt_insert" on public.dm_threads for insert to authenticated with check (
  (auth.uid() = user_a or auth.uid() = user_b)
  and public.can_dm(auth.uid(), case when user_a = auth.uid() then user_b else user_a end)
);

-- dm_messages: восстановлена проверка блокировки (регрессия из 57) + для 1-в-1
-- ещё и приватность сообщений получателя; для групп — только членство (без
-- privacy-проверки, состав группы уже сам себе разрешение писать в неё).
drop policy if exists "dm_insert" on public.dm_messages;
create policy "dm_insert" on public.dm_messages for insert to authenticated with check (
  author = auth.uid() and (
    (
      exists (select 1 from public.dm_threads t where t.id = dm_messages.thread_id
              and (t.user_a = auth.uid() or t.user_b = auth.uid()))
      and not exists (
        select 1 from public.dm_threads t join public.blocked_users b
          on (b.blocker_id in (t.user_a, t.user_b) and b.blocked_id in (t.user_a, t.user_b))
        where t.id = dm_messages.thread_id
      )
      and public.can_dm(auth.uid(), (
        select case when t.user_a = auth.uid() then t.user_b else t.user_a end
        from public.dm_threads t where t.id = dm_messages.thread_id
      ))
    )
    or public.is_dm_participant(dm_messages.thread_id)
  )
);
