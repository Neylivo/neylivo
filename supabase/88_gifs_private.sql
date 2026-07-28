-- 88: «Мои GIF» были общими на всё приложение (v1.331.0).
--
-- Вкладка называется «Мои GIF», внутри — «Все твои GIF», и это личная коллекция:
-- человек складывает туда гифки, чтобы отправлять их потом. А в базе с самого
-- первого дня (07_shared_emoji_gifs.sql, там таблица прямо названа «общей»)
-- стояло:
--     gifs_read   for select using (true)
--     gifs_delete for delete to authenticated using (true)
-- То есть на вкладке лежали гифки ВСЕХ пользователей приложения вперемешку со
-- своими (запрос в GifPicker.tsx шёл без фильтра по владельцу), а крестик рядом
-- с каждой удалял чужую. Плюс любой вошедший мог выгрузить чужую коллекцию
-- целиком — а что человек сохраняет себе, тоже говорит о нём.
--
-- Приводим базу к тому, чем эта вкладка является: своё видно и удаляется, чужое
-- не видно и не трогается. Ничьи (owner is null — учётную запись удалили)
-- остаются удаляемыми, иначе их не убрать никогда.
drop policy if exists "gifs_read" on public.gifs;
create policy "gifs_read" on public.gifs for select to authenticated
  using (owner = auth.uid());

drop policy if exists "gifs_delete" on public.gifs;
create policy "gifs_delete" on public.gifs for delete to authenticated
  using (owner = auth.uid() or owner is null);
