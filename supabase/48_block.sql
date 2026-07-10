-- 48_block.sql — блокировка пользователя как в настоящем Discord: останавливает
-- переписку в обе стороны на уровне БД (не только клиента), а не просто «скрыть
-- у себя» (для этого есть отдельный, более лёгкий dm_ignored из 47_dm_prefs.sql).
create table if not exists blocked_users (
  blocker_id uuid not null references auth.users on delete cascade,
  blocked_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
alter table blocked_users enable row level security;
-- Читать может любая из двух сторон пары — нужно и клиенту (понять, что переписка
-- заблокирована), и WITH CHECK ниже (сендер должен видеть блок, поставленный получателем).
create policy "blk_read"   on blocked_users for select to authenticated using (auth.uid() = blocker_id or auth.uid() = blocked_id);
create policy "blk_insert" on blocked_users for insert to authenticated with check (auth.uid() = blocker_id);
create policy "blk_delete" on blocked_users for delete to authenticated using (auth.uid() = blocker_id);

-- Дописываем блок-проверку в insert-политику dm_messages (см. 02_friends_dm.sql) —
-- сохраняем исходное условие (author = auth.uid() + участник треда) и добавляем:
-- если между участниками треда есть блокировка в любую сторону, сообщение не пройдёт.
drop policy if exists "dm_insert" on dm_messages;
create policy "dm_insert" on dm_messages for insert with check (
  author = auth.uid() and exists (
    select 1 from dm_threads t where t.id = dm_messages.thread_id
    and (t.user_a = auth.uid() or t.user_b = auth.uid()))
  and not exists (
    select 1 from dm_threads t join blocked_users b
      on (b.blocker_id in (t.user_a, t.user_b) and b.blocked_id in (t.user_a, t.user_b))
    where t.id = dm_messages.thread_id
  )
);
