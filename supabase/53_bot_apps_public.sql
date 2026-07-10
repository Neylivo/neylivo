-- 53_bot_apps_public.sql (v1.198.0) — фикс: "ba_read" в 50_bots.sql ограничивает
-- select на bot_apps владельцем (auth.uid() = owner_id). Но два реальных клиентских
-- пути обязаны видеть чужие бот-приложения:
--   - fetchServerBotCommands (src/lib/botApi.ts) — автодополнение /команд ботов,
--     реально стоящих на сервере (боты почти всегда чужие — их владелец другой
--     разработчик);
--   - ServerBotsPanel (src/components/DevPortal.tsx) — вкладка «Боты» в настройках
--     сервера должна показывать ВСЕХ установленных ботов, а не только те, что
--     создал сам смотрящий.
-- RLS не умеет прятать колонки — только строки, поэтому секреты (token_hash,
-- webhook_secret) остаются доступны исключительно через владельческую политику
-- "ba_read" на самой таблице; здесь — отдельное вью с явным перечнем безопасных
-- колонок, доступное всем авторизованным. Вью создаётся под ролью применяющей
-- миграцию (обычно bypass RLS), поэтому видит все строки таблицы независимо от RLS.
create or replace view bot_apps_public as
  select id, bot_user_id, name, avatar_url, created_at from bot_apps;
grant select on bot_apps_public to authenticated;
