-- 51_realtime_sync.sql — три таблицы, от которых зависит мгновенная синхронизация
-- между устройствами/пользователями, никогда не были добавлены в публикацию
-- supabase_realtime (в отличие от messages/dm_messages/reactions/member_roles
-- и т.д. — см. остальные миграции). Из-за этого:
--   • profiles  — смена аватарки/ника/тега сервера (tag_server_id) не долетала
--     живым событием до других людей; src/lib/avatars.ts уже ГОД как подписан
--     на UPDATE profiles (см. ensureRealtime()), просто эта подписка молчала —
--     без публикации Supabase Realtime не шлёт по ней вообще ничего.
--   • user_prefs — смена настроек (заметки, мьюты, папки, dm_pinned и т.п.) на
--     одном устройстве не появлялась на другом без перезахода — initUserPrefs()
--     читает эту таблицу только один раз при логине.
--   • servers — смена тега сервера (settings.tag) в настройках не долетала до
--     тех, кто этот тег уже носит — src/lib/userTag.ts кэширует тег сервера
--     бессрочно, инвалидация была только у того, кто сам открыл настройки.
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table user_prefs;
alter publication supabase_realtime add table servers;
