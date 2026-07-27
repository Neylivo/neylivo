-- 76: чтение справочных таблиц требует входа (v1.313.0).
--
-- Что было. Часть политик осталась с самой первой схемы в виде
-- `for select using (true)` БЕЗ указания роли. Указание роли здесь не мелочь:
-- без него политика распространяется и на роль anon, то есть на публичный ключ,
-- который по своей природе лежит в каждой сборке клиента и доступен кому угодно.
--
-- Практически это означало, что человек без аккаунта мог выгрузить:
--   • profiles — всех пользователей: ник, отображаемое имя, аватар и, что хуже,
--     last_seen, то есть когда каждый был в сети;
--   • servers — все серверы приложения;
--   • music_tracks, custom_emoji, gifs, emoji_packs, emoji_pack_items — их содержимое.
--
-- Для приложения, которое мы делаем анонимным, возможность посчитать всех
-- пользователей и посмотреть, когда кто заходил, вообще не заводя аккаунта —
-- прямое противоречие. Аудит v1.200.0 (миграция 54) закрыл приглашения, вступление
-- и мероприятия сервера, но до этих таблиц не дошёл.
--
-- Что меняется. Только РОЛЬ: правило видимости остаётся прежним (`using (true)`),
-- потому что поиск людей и серверов внутри приложения на нём и держится. Ничего
-- из того, что видел вошедший пользователь, он видеть не перестанет.
--
-- Анонимный вход (v1.306.0) не затрагивается: такой пользователь получает роль
-- authenticated, как и обычный, — «анонимный» в нём про отсутствие почты, а не
-- про отсутствие сессии.

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to authenticated using (true);

drop policy if exists "servers_read" on public.servers;
create policy "servers_read" on public.servers
  for select to authenticated using (true);

drop policy if exists "music_read" on public.music_tracks;
create policy "music_read" on public.music_tracks
  for select to authenticated using (true);

drop policy if exists "emoji_read" on public.custom_emoji;
create policy "emoji_read" on public.custom_emoji
  for select to authenticated using (true);

drop policy if exists "gifs_read" on public.gifs;
create policy "gifs_read" on public.gifs
  for select to authenticated using (true);

drop policy if exists "epacks_read" on public.emoji_packs;
create policy "epacks_read" on public.emoji_packs
  for select to authenticated using (true);

drop policy if exists "epitems_read" on public.emoji_pack_items;
create policy "epitems_read" on public.emoji_pack_items
  for select to authenticated using (true);

-- Проверка входа по нику и занятости имени продолжает работать без аккаунта:
-- она идёт не прямым чтением таблицы, а функциями username_taken/email_taken,
-- которым доступ роли anon выдан отдельно и осознанно (миграции 20 и 38).
