-- v1.169.0: виджеты профиля «Хочу поиграть» и «Текущие игры» — как в Discord,
-- те же jsonb-массивы названий игр, что уже есть у fav_games (см. 37_fav_games.sql).
alter table profiles add column if not exists wish_games jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists play_games jsonb not null default '[]'::jsonb;
