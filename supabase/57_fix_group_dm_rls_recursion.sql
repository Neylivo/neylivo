-- 57_fix_group_dm_rls_recursion.sql — критичный фикс после 56_group_dm.sql
-- (v1.227.0): "dmp_read" на dm_participants проверяла членство EXISTS-подзапросом
-- К ТОЙ ЖЕ ТАБЛИЦЕ dm_participants — классическая ловушка PostgreSQL RLS,
-- "infinite recursion detected in policy for relation dm_participants". А так как
-- "dt_read" (dm_threads) и "dm_read"/"dm_insert" (dm_messages) сами ссылаются на
-- dm_participants в своих EXISTS-подзапросах, эта рекурсия ломала ЛЮБОЙ запрос
-- к dm_threads/dm_messages — включая самые обычные 1-в-1 диалоги без единой
-- группы. Отсюда «диалог не открывается»/«сообщения не уходят» у кого угодно.
--
-- Фикс: проверка членства через security definer функцию — она обходит RLS
-- изнутри своего же тела, так что рекурсии больше неоткуда взяться.
create or replace function public.is_dm_participant(p_thread_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.dm_participants where thread_id = p_thread_id and user_id = auth.uid());
$$;
revoke all on function public.is_dm_participant(uuid) from public;
grant execute on function public.is_dm_participant(uuid) to authenticated;

drop policy if exists "dmp_read" on public.dm_participants;
create policy "dmp_read" on public.dm_participants for select to authenticated using (
  public.is_dm_participant(thread_id)
);

drop policy if exists "dt_read" on public.dm_threads;
create policy "dt_read" on public.dm_threads for select to authenticated using (
  auth.uid() = user_a or auth.uid() = user_b or public.is_dm_participant(dm_threads.id)
);

drop policy if exists "dm_read" on public.dm_messages;
create policy "dm_read" on public.dm_messages for select to authenticated using (
  exists (select 1 from public.dm_threads t where t.id = dm_messages.thread_id
          and (t.user_a = auth.uid() or t.user_b = auth.uid()))
  or public.is_dm_participant(dm_messages.thread_id)
);
drop policy if exists "dm_insert" on public.dm_messages;
create policy "dm_insert" on public.dm_messages for insert to authenticated with check (
  author = auth.uid() and (
    exists (select 1 from public.dm_threads t where t.id = dm_messages.thread_id
            and (t.user_a = auth.uid() or t.user_b = auth.uid()))
    or public.is_dm_participant(dm_messages.thread_id)
  )
);
