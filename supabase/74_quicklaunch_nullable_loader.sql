-- 74: у части реальных сборок (в т.ч. инстансов Prism Launcher) нет модового
-- загрузчика вообще — чистый vanilla. quicklaunch_packs.loader/loader_version
-- были NOT NULL (см. 43_quicklaunch.sql), из-за чего createPack() падал с
-- ошибкой ограничения при попытке поделиться такой сборкой. Разрешаем NULL и
-- убираем дефолт 'forge' — теперь честно nullable, как оно и есть по факту.

alter table public.quicklaunch_packs alter column loader drop default;
alter table public.quicklaunch_packs alter column loader drop not null;
alter table public.quicklaunch_packs alter column loader_version drop not null;
