-- 44: bucket для файлов модов (QuickLaunch) — контент-адресация по sha1
-- (путь объекта = "<sha1>.jar"), поэтому в отличие от avatars/attachments
-- НЕТ префикса по uid: один и тот же мод, залитый разными хостами, физически
-- хранится один раз (дедуп на уровне всего Ponoi, не только своих сборок).
--
-- ПЕРЕД выполнением создай в Supabase -> Storage бакет:
--   modfiles   (Public bucket: ON)
-- Затем выполни этот файл в SQL Editor.

create policy "modfiles_read" on storage.objects for select using ( bucket_id = 'modfiles' );

-- Вставка разрешена любому авторизованному в любой путь бакета (не только свой
-- uid-префикс, как у avatars/attachments) — путь тут не личный, а хеш файла.
-- Объекты неизменяемы (тот же хеш = то же содержимое), апдейт/удаление не нужны.
create policy "modfiles_write" on storage.objects for insert to authenticated
  with check ( bucket_id = 'modfiles' );
