-- Ponoi — этап 6 миграции: ОБЩЕЕ (серверное) хранение.
-- Делает видимыми ВСЕМ и с любого устройства: аватарки серверов + акцент,
-- тему профиля / «о себе» / питомца профиля, и общую Трекотеку.
-- Выполни в Supabase Dashboard -> SQL Editor ПОСЛЕ 05_reactions_pins.sql.
-- Новые бакеты Storage создавать НЕ нужно — медиа грузятся в уже существующий
-- публичный бакет `avatars` (создан в 04_storage.sql).

-- 1) Серверы: аватарка + акцент (раньше жили только в localStorage)
alter table servers add column if not exists avatar_url text;
alter table servers add column if not exists accent text;

-- обновлять сервер (имя / аватар / акцент) может владелец
drop policy if exists "servers_update" on servers;
create policy "servers_update" on servers for update using (auth.uid() = owner);

-- 2) Профиль: тема карточки, «о себе», питомец профиля (раньше в localStorage)
alter table profiles add column if not exists primary_color text;
alter table profiles add column if not exists accent_color text;
alter table profiles add column if not exists about text;
alter table profiles add column if not exists pet_url text;
alter table profiles add column if not exists pet_kind text;   -- image | gif | video | model | none
alter table profiles add column if not exists pet_on boolean not null default false;
alter table profiles add column if not exists pet_size int not null default 180;
alter table profiles add column if not exists pet_pos text not null default 'tr';

-- 3) Общая Трекотека: единая таблица треков — её видят ВСЕ,
--    и в неё любой авторизованный может добавить трек.
create table if not exists music_tracks (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  name text not null,
  owner uuid not null references auth.users on delete cascade,
  owner_name text,
  kind text not null default 'url',   -- url | file
  created_at timestamptz not null default now()
);

alter table music_tracks enable row level security;

-- читают ВСЕ; добавляет любой авторизованный (owner = он сам); удаляет добавивший
drop policy if exists "music_read"   on music_tracks;
drop policy if exists "music_insert" on music_tracks;
drop policy if exists "music_delete" on music_tracks;
create policy "music_read"   on music_tracks for select using (true);
create policy "music_insert" on music_tracks for insert to authenticated with check (auth.uid() = owner);
create policy "music_delete" on music_tracks for delete using (auth.uid() = owner);

-- Realtime: новые треки появляются у всех сразу
alter publication supabase_realtime add table music_tracks;