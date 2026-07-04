-- 14: История активностей — игровые сессии для вкладки «История активностей» в фулл-профиле.
-- Десктоп пишет старт при запуске игры и проставляет ended_at при выходе.
create table if not exists public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'game',
  name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists activity_sessions_user_idx on public.activity_sessions (user_id, started_at desc);

alter table public.activity_sessions enable row level security;

create policy "activity read" on public.activity_sessions
  for select to authenticated using (true);

create policy "activity insert own" on public.activity_sessions
  for insert to authenticated with check (auth.uid() = user_id);

create policy "activity update own" on public.activity_sessions
  for update to authenticated using (auth.uid() = user_id);
