-- 31_wall_storage_delete.sql — доудаляем файлы «Стены росписи» из Storage (v1.147.0)
-- Раньше delete-политики на avatars не было вовсе, поэтому deleteDrawing() удалял
-- только строку в wall_drawings, а сам PNG в бакете оставался мусором навсегда.
-- Два случая удаления:
--   1) свой файл в своей папке (обычный кейс, как в avatars_write/avatars_update);
--   2) владелец стены удаляет рисунок ДРУГОГО автора — файл лежит в чужой папке,
--      поэтому даём доступ через связь с wall_drawings.image_url.
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "avatars_delete_wall" on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars' and exists (
      select 1 from public.wall_drawings w
      where w.image_url like '%/' || storage.objects.name
        and (w.author_id = auth.uid() or w.wall_user_id = auth.uid())
    )
  );
