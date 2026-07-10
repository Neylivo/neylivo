-- 47_dm_prefs.sql — контекстное меню друга в списке ЛС (закреп/мьют/никнейм/
-- «закрыть ЛС»/игнор): новые jsonb-колонки в user_prefs (миграция 39), тот же
-- паттерн, что notes/ch_muted/dm_read — одна приватная строка на пользователя,
-- патчится через patchUserPrefs() как есть (см. src/lib/userPrefs.ts).
alter table user_prefs add column if not exists dm_pinned  jsonb not null default '[]'::jsonb;  -- [friendId] — закреплённые вверху списка ЛС
alter table user_prefs add column if not exists dm_muted   jsonb not null default '{}'::jsonb;   -- {friendId: expiryMs} — 0 = навсегда, иначе до какого времени молчит
alter table user_prefs add column if not exists dm_closed  jsonb not null default '[]'::jsonb;   -- [friendId] — «Закрыть ЛС», скрыт из списка, пока не напишет снова
alter table user_prefs add column if not exists dm_ignored jsonb not null default '[]'::jsonb;   -- [friendId] — игнор: сообщения свёрнуты только у тебя, дружба/переписка не трогаются
alter table user_prefs add column if not exists friend_nick jsonb not null default '{}'::jsonb;  -- {friendId: nickname} — виден только тебе
