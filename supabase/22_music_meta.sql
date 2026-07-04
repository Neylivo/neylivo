-- Ponoi — этап 22 миграции: метаданные треков в общей Трекотеке.
-- Автор/обложка/длительность/прямой play-URL теперь хранятся в базе, чтобы трек,
-- добавленный из SoundCloud, у ВСЕХ пользователей выглядел красиво сразу и навсегда
-- (а не тянулся заново из SoundCloud на каждом устройстве).
-- Выполни в Supabase Dashboard -> SQL Editor.

alter table music_tracks add column if not exists author text;
alter table music_tracks add column if not exists art text;
alter table music_tracks add column if not exists duration int;   -- секунды
alter table music_tracks add column if not exists play_url text;  -- прямой URL для плеера (api.soundcloud.com/tracks/… и т.п.)
