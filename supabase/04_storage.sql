-- Ponoi — этап 4 миграции: Storage (аватары и вложения).
-- ПЕРЕД выполнением создай два бакета в Supabase -> Storage:
--   1) avatars      (Public bucket: ON)
--   2) attachments  (Public bucket: ON)
-- Затем выполни этот файл в SQL Editor.

-- профиль получает ссылку на аватар и картинку
alter table profiles add column if not exists avatar_url text;

-- сообщения могут нести вложение (картинку/файл)
alter table messages    add column if not exists attach_url text;
alter table messages    add column if not exists attach_type text;   -- image | file
alter table dm_messages add column if not exists attach_url text;
alter table dm_messages add column if not exists attach_type text;

-- Политики Storage: читать могут все (бакеты публичные),
-- загружать/менять/удалять — только авторизованные пользователи,
-- и только внутри папки со своим user id (storage.foldername[1] = uid).
create policy "avatars_read" on storage.objects for select using ( bucket_id = 'avatars' );
create policy "avatars_write" on storage.objects for insert to authenticated
  with check ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );
create policy "avatars_update" on storage.objects for update to authenticated
  using ( bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "attach_read" on storage.objects for select using ( bucket_id = 'attachments' );
create policy "attach_write" on storage.objects for insert to authenticated
  with check ( bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text );
