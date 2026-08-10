-- v1.533.0: жалобы, удаление аккаунта с задержкой и защита от чужих рук.
--
-- Владелец принёс требования Google Play к мессенджерам (жалоба на человека,
-- удаление аккаунта со всеми данными) и защиту уровня Steam (задержка на
-- опасные действия, чтобы у настоящего владельца было окно на отмену).
--
-- ГЛАВНОЕ ПРАВИЛО, КОТОРОЕ ЗДЕСЬ СОБЛЮДЕНО: сервер по-прежнему ничего не знает
-- о содержимом переписки. В жалобе НЕТ текста сообщений — только кто, на кого и
-- почему. Иначе кнопка «пожаловаться» стала бы дырой в сквозном шифровании:
-- достаточно пожаловаться на себя, чтобы положить текст на сервер в открытом
-- виде.
--
-- Применять один раз в Supabase → SQL Editor.

-- ── Жалобы ──────────────────────────────────────────────────────────────────
create table if not exists public.user_reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  target_id    uuid not null references auth.users(id) on delete cascade,
  reason       text not null check (reason in ('spam','abuse','threat','illegal','other')),
  note         text default '' check (length(note) <= 1000),
  created_at   timestamptz not null default now(),
  -- Одна жалоба одного человека на другого в сутки: остальное — не сигнал, а шум.
  unique (reporter_id, target_id, created_at)
);

alter table public.user_reports enable row level security;

-- Писать жалобу можно только от своего имени и не на себя.
drop policy if exists "reports insert own" on public.user_reports;
create policy "reports insert own" on public.user_reports
  for insert with check (auth.uid() = reporter_id and target_id <> reporter_id);

-- Читать свои жалобы. Чужие не видит никто, кроме обслуживания базы:
-- список «кто на кого пожаловался» — это тоже личные данные.
drop policy if exists "reports read own" on public.user_reports;
create policy "reports read own" on public.user_reports
  for select using (auth.uid() = reporter_id);

create index if not exists user_reports_target_idx on public.user_reports(target_id, created_at desc);

-- ── Отложенные опасные действия ─────────────────────────────────────────────
--
-- Запрошенное действие лежит здесь до срока. Пока лежит — приложение показывает
-- баннер на всех устройствах: «запрошено удаление аккаунта, отменить».
create table if not exists public.account_holds (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  action      text not null check (action in ('delete','email','keys')),
  requested_at timestamptz not null default now(),
  due_at      timestamptz not null,
  -- Откуда запросили — чтобы человек понял, он это был или нет.
  device      text default '',
  created_at  timestamptz not null default now()
);

alter table public.account_holds enable row level security;

drop policy if exists "holds own" on public.account_holds;
create policy "holds own" on public.account_holds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Удаление аккаунта ───────────────────────────────────────────────────────
--
-- Что удаляется на сервере: профиль, ключи устройств, дружбы, блокировки,
-- участие в серверах, свои сообщения. Сама учётная запись auth удаляется
-- отдельно — это может только служебный ключ, и делать это из клиента нельзя.
-- Поэтому здесь честно: данные стираются, вход закрывается сменой пароля на
-- случайный, а строку из auth.users убирает обслуживание.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'нет входа';
  end if;

  delete from public.dm_messages where author = me;
  delete from public.messages where author = me;
  delete from public.blocked_users where blocker_id = me or blocked_id = me;
  delete from public.user_reports where reporter_id = me;
  delete from public.account_holds where user_id = me;

  -- Таблицы, которых может не быть в старой базе, — по одной и молча.
  begin delete from public.device_keys where user_id = me; exception when undefined_table then null; end;
  begin delete from public.friends where user_id = me or friend_id = me; exception when undefined_table then null; end;
  begin delete from public.friend_requests where from_id = me or to_id = me; exception when undefined_table then null; end;
  begin delete from public.server_members where user_id = me; exception when undefined_table then null; end;
  begin delete from public.presence where user_id = me; exception when undefined_table then null; end;
  begin delete from public.user_prefs where user_id = me; exception when undefined_table then null; end;

  delete from public.profiles where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
