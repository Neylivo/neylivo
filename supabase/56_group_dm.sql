-- 56_group_dm.sql — групповые беседы (v1.223.0): «+» у «Личные сообщения» теперь
-- открывает «Новую беседу» с выбором сразу нескольких друзей (как в Discord, до
-- 10 участников включая себя), а не только диалог 1-на-1. Существующие 1-в-1
-- диалоги (dm_threads.user_a/user_b) не тронуты и работают как раньше — групповые
-- беседы используют те же dm_threads/dm_messages (is_group=true), просто состав
-- хранится отдельно в dm_participants, т.к. участников может быть больше двух.

alter table public.dm_threads alter column user_a drop not null;
alter table public.dm_threads alter column user_b drop not null;
alter table public.dm_threads add column if not exists is_group boolean not null default false;
alter table public.dm_threads add column if not exists name text;
alter table public.dm_threads add column if not exists owner_id uuid references auth.users on delete set null;

create table if not exists public.dm_participants (
  thread_id uuid not null references public.dm_threads on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  added_by uuid references auth.users,
  joined_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);
alter table public.dm_participants enable row level security;

-- Состав групповой беседы видят только её участники.
drop policy if exists "dmp_read" on public.dm_participants;
create policy "dmp_read" on public.dm_participants for select to authenticated using (
  exists (select 1 from public.dm_participants me where me.thread_id = dm_participants.thread_id and me.user_id = auth.uid())
);

-- dm_threads: участник группы теперь тоже видит свою беседу (не только user_a/user_b 1-в-1).
drop policy if exists "dt_read" on public.dm_threads;
create policy "dt_read" on public.dm_threads for select to authenticated using (
  auth.uid() = user_a or auth.uid() = user_b
  or exists (select 1 from public.dm_participants p where p.thread_id = dm_threads.id and p.user_id = auth.uid())
);

-- dm_messages: то же расширение видимости на участников группы.
drop policy if exists "dm_read" on public.dm_messages;
create policy "dm_read" on public.dm_messages for select to authenticated using (
  exists (select 1 from public.dm_threads t where t.id = dm_messages.thread_id
          and (t.user_a = auth.uid() or t.user_b = auth.uid()))
  or exists (select 1 from public.dm_participants p where p.thread_id = dm_messages.thread_id and p.user_id = auth.uid())
);
drop policy if exists "dm_insert" on public.dm_messages;
create policy "dm_insert" on public.dm_messages for insert to authenticated with check (
  author = auth.uid() and (
    exists (select 1 from public.dm_threads t where t.id = dm_messages.thread_id
            and (t.user_a = auth.uid() or t.user_b = auth.uid()))
    or exists (select 1 from public.dm_participants p where p.thread_id = dm_messages.thread_id and p.user_id = auth.uid())
  )
);

-- Создать групповую беседу: сам вызывающий + минимум 2 друга (итого 3+ человек —
-- беседа вдвоём это уже обычная ЛС). Максимум 10 участников всего, как в Discord.
-- Название необязательно (Discord тоже не спрашивает его при создании — можно
-- переименовать потом).
create or replace function public.create_group_dm(p_member_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_thread_id uuid;
  v_ids uuid[];
begin
  select array_agg(distinct x) into v_ids from unnest(p_member_ids || auth.uid()) as x;
  if array_length(v_ids, 1) < 3 then raise exception 'group_dm_needs_3_members'; end if;
  if array_length(v_ids, 1) > 10 then raise exception 'group_dm_too_many_members'; end if;
  insert into public.dm_threads (is_group, owner_id) values (true, auth.uid())
    returning id into v_thread_id;
  insert into public.dm_participants (thread_id, user_id, added_by)
    select v_thread_id, uid, auth.uid() from unnest(v_ids) as uid;
  return v_thread_id;
end;
$$;
revoke all on function public.create_group_dm(uuid[]) from public;
grant execute on function public.create_group_dm(uuid[]) to authenticated;

-- Добавить участника (может любой текущий участник, пока не набрано 10).
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
  select count(*) into v_count from public.dm_participants where thread_id = p_thread_id;
  if v_count >= 10 then raise exception 'group_dm_full'; end if;
  insert into public.dm_participants (thread_id, user_id, added_by) values (p_thread_id, p_user_id, auth.uid())
    on conflict (thread_id, user_id) do nothing;
end;
$$;
revoke all on function public.add_group_member(uuid, uuid) from public;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;

-- Убрать участника: себя может убрать (выйти) кто угодно; убрать ДРУГОГО может
-- только владелец беседы. Если ушёл владелец — владение переходит следующему по
-- дате вступления; если беседа опустела — удаляется целиком (сообщения каскадом).
create or replace function public.remove_group_member(p_thread_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_left int;
begin
  select owner_id into v_owner from public.dm_threads where id = p_thread_id and is_group;
  if v_owner is null then raise exception 'not_a_group'; end if;
  if p_user_id <> auth.uid() and v_owner <> auth.uid() then raise exception 'not_allowed'; end if;
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
revoke all on function public.remove_group_member(uuid, uuid) from public;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

-- Переименовать беседу — доступно любому участнику (как в Discord).
create or replace function public.rename_group_dm(p_thread_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.dm_participants p where p.thread_id = p_thread_id and p.user_id = auth.uid()) then
    raise exception 'not_a_member';
  end if;
  update public.dm_threads set name = nullif(trim(p_name), '') where id = p_thread_id and is_group;
end;
$$;
revoke all on function public.rename_group_dm(uuid, text) from public;
grant execute on function public.rename_group_dm(uuid, text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_participants') then
    alter publication supabase_realtime add table dm_participants;
  end if;
end $$;
