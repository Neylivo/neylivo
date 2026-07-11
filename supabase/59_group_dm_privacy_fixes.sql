-- 59_group_dm_privacy_fixes.sql — закрывает дыры, найденные при ревью 56/58:
--
-- 1. can_call() не проверял blocked_users — если у цели dm_call_privacy='all',
--    заблокированный ею человек всё равно мог позвонить (сообщения при этом
--    уже были правильно заблокированы через dm_insert). Теперь блокировка
--    проверяется первой, ДО настройки приватности.
-- 2. create_group_dm/add_group_member не проверяли дружбу — устроить группу
--    с любым чужим uuid мог кто угодно напрямую через RPC, в обход того, что
--    UI разрешает выбирать только друзей.
-- 3. Ту же пару функций можно было использовать, чтобы затащить в беседу
--    людей с взаимной блокировкой (block работал только для диалогов 1-в-1).
-- 4. add_group_member: между «прочитать count» и «вставить участника» не было
--    блокировки — два одновременных добавления при 9/10 участниках могли
--    вместе провести беседу за лимit в 10 человек.
-- 5. remove_group_member опознавал «не группа» по owner_id is null, но owner_id
--    становится null и когда владелец существующей группы удалил аккаунт
--    (dm_threads.owner_id ... on delete set null) — после этого функция для
--    такой группы навсегда отказывала всем, группу нельзя было ни покинуть,
--    ни почистить. Заодно эта же путаница делала пустой and-проверку
--    (v_owner <> auth.uid() при v_owner = null даёт NULL, а не true) —
--    участник мог кикнуть ЛЮБОГО другого, если владелец уже пропал.

create or replace function public.can_call(p_target uuid) returns boolean
language plpgsql security definer set search_path = public stable as $$
declare v_privacy text; v_friend boolean;
begin
  if p_target = auth.uid() then return true; end if;
  if exists (
    select 1 from public.blocked_users b
    where (b.blocker_id = auth.uid() and b.blocked_id = p_target)
       or (b.blocker_id = p_target and b.blocked_id = auth.uid())
  ) then
    return false;
  end if;
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

create or replace function public.create_group_dm(p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_thread_id uuid;
  v_ids uuid[];
begin
  select array_agg(distinct x) into v_ids from unnest(p_member_ids || auth.uid()) as x;
  if array_length(v_ids, 1) < 3 then raise exception 'group_dm_needs_3_members'; end if;
  if array_length(v_ids, 1) > 10 then raise exception 'group_dm_too_many_members'; end if;
  if exists (select 1 from unnest(v_ids) as uid where uid <> auth.uid() and not public.are_friends(auth.uid(), uid)) then
    raise exception 'not_friends';
  end if;
  if exists (
    select 1 from public.blocked_users b
    where b.blocker_id = any(v_ids) and b.blocked_id = any(v_ids)
  ) then
    raise exception 'blocked_member';
  end if;
  insert into public.dm_threads (is_group, owner_id) values (true, auth.uid())
    returning id into v_thread_id;
  insert into public.dm_participants (thread_id, user_id, added_by)
    select v_thread_id, uid, auth.uid() from unnest(v_ids) as uid;
  return v_thread_id;
end;
$$;

create or replace function public.add_group_member(p_thread_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not exists (select 1 from public.dm_threads t where t.id = p_thread_id and t.is_group) then
    raise exception 'not_a_group';
  end if;
  if not exists (select 1 from public.dm_participants p where p.thread_id = p_thread_id and p.user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  if not public.are_friends(auth.uid(), p_user_id) then raise exception 'not_friends'; end if;
  if exists (
    select 1 from public.dm_participants p join public.blocked_users b
      on (b.blocker_id = p.user_id and b.blocked_id = p_user_id) or (b.blocker_id = p_user_id and b.blocked_id = p.user_id)
    where p.thread_id = p_thread_id
  ) then
    raise exception 'blocked_member';
  end if;
  -- Сериализуем добавления в ОДНУ и ту же беседу — без этого два одновременных
  -- add_group_member при 9 участниках могли оба пройти проверку count<10 и
  -- вместе провести беседу за лимит в 10 (TOCTOU).
  perform pg_advisory_xact_lock(hashtext('group_dm:' || p_thread_id::text)::bigint);
  select count(*) into v_count from public.dm_participants where thread_id = p_thread_id;
  if v_count >= 10 then raise exception 'group_dm_full'; end if;
  insert into public.dm_participants (thread_id, user_id, added_by) values (p_thread_id, p_user_id, auth.uid())
    on conflict (thread_id, user_id) do nothing;
end;
$$;

create or replace function public.remove_group_member(p_thread_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_is_group boolean; v_left int;
begin
  select owner_id, is_group into v_owner, v_is_group from public.dm_threads where id = p_thread_id;
  if not coalesce(v_is_group, false) then raise exception 'not_a_group'; end if;
  -- Владелец пропал (например, удалил аккаунт — owner_id ... on delete set null):
  -- вместо того, чтобы навсегда блокировать группу, назначаем владельцем
  -- самого раннего по вступлению участника, как и при обычном уходе владельца ниже.
  if v_owner is null then
    select user_id into v_owner from public.dm_participants where thread_id = p_thread_id order by joined_at asc limit 1;
    if v_owner is not null then
      update public.dm_threads set owner_id = v_owner where id = p_thread_id;
    end if;
  end if;
  if p_user_id <> auth.uid() and (v_owner is null or v_owner <> auth.uid()) then raise exception 'not_allowed'; end if;
  delete from public.dm_participants where thread_id = p_thread_id and user_id = p_user_id;
  select count(*) into v_left from public.dm_participants where thread_id = p_thread_id;
  if v_left = 0 then
    delete from public.dm_threads where id = p_thread_id;
  elsif p_user_id = v_owner then
    update public.dm_threads set owner_id = (
      select user_id from public.dm_participants where thread_id = p_thread_id order by joined_at asc limit 1
    ) where id = p_thread_id;
  end if;
end;
$$;
