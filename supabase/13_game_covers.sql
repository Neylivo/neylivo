-- 13: обложки игр для активности «Играет в …» (общий кэш на всех пользователей).
-- Игра ищется во внешнем API один раз, результат (или not_found) кэшируется здесь.

create table if not exists public.game_covers (
  name text primary key,
  cover_url text,
  status text not null default 'ok' check (status in ('ok', 'not_found')),
  checked_at timestamptz not null default now()
);

alter table public.game_covers enable row level security;

drop policy if exists "game_covers read" on public.game_covers;
create policy "game_covers read" on public.game_covers
  for select to authenticated using (true);

drop policy if exists "game_covers insert" on public.game_covers;
create policy "game_covers insert" on public.game_covers
  for insert to authenticated with check (true);

drop policy if exists "game_covers update" on public.game_covers;
create policy "game_covers update" on public.game_covers
  for update to authenticated using (true);
