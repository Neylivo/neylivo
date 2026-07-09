-- 32_game_matches.sql — история завершённых матчей онлайн-игр (v1.150.0)
-- Пишется из GSI-детекта (CS2 сейчас; другие игры — по мере появления
-- официального способа узнать финальный счёт/карту/режим матча).
-- Статистика за 30 дней по конкретной игре собирается на клиенте из этой таблицы.
create table if not exists public.game_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  game_name text not null,
  score text,
  mode text,
  map text,
  result text,   -- 'win' | 'loss' | 'draw' | null (null — когда своя сторона неизвестна)
  created_at timestamptz not null default now()
);

create index if not exists game_matches_user_game_idx on public.game_matches (user_id, game_name, created_at desc);

alter table public.game_matches enable row level security;

-- Матчи видит только сам игрок — это его личная история, не публичная лента.
drop policy if exists "game_matches select own" on public.game_matches;
create policy "game_matches select own" on public.game_matches
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "game_matches insert own" on public.game_matches;
create policy "game_matches insert own" on public.game_matches
  for insert to authenticated with check (user_id = auth.uid());
