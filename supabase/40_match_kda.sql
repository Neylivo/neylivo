-- v1.165.0: CS2 GSI теперь подписан на "player_match_stats" (см. electron/main.cjs),
-- поэтому конец матча приходит вместе с личными kills/deaths/assists/mvps —
-- раньше GameStatsModal показывал только счёт/карту/режим/результат.
alter table public.game_matches add column if not exists kills integer;
alter table public.game_matches add column if not exists deaths integer;
alter table public.game_matches add column if not exists assists integer;
alter table public.game_matches add column if not exists mvps integer;
