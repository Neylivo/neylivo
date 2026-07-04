-- v1.39.0: ник (отображаемое имя) отдельно от юзернейма
-- Ник может повторяться у разных людей и меняться свободно.
-- Юзернейм остаётся уникальным идентификатором (правила из 20_username_rules.sql).
alter table public.profiles add column if not exists display_name text;
