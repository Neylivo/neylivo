-- v1.169.0: виджет профиля «Хочу поиграть» — как в Discord, тот же jsonb-массив
-- названий игр, что уже есть у fav_games (см. 37_fav_games.sql).
alter table profiles add column if not exists wish_games jsonb not null default '[]'::jsonb;
