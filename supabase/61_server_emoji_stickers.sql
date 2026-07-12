-- v1.250.0: эмодзи и стикеры СЕРВЕРА — как в Discord: у сервера свой пак, и он
-- автоматически доступен всем участникам сразу при вступлении, без отдельного шага
-- «выдать доступ» — потому что видимость просто читается live-запросом «эмодзи
-- серверов, где я состою» (server_members), а не хранится отдельным грантом.
--
-- Раньше «эмодзи»/«стикеры» в настройках сервера (ServerSettings.tsx) писались
-- в servers.settings (JSON) и НИКЕМ не читались — чисто декоративная заглушка.
-- custom_emoji (07_shared_emoji_gifs.sql) — отдельная, ГЛОБАЛЬНАЯ по имени
-- личная коллекция (name text primary key, без server_id) — её не трогаем,
-- server_emoji ниже — независимая коллекция без глобального конфликта имён
-- (уникальность имени только within один сервер).

create table if not exists server_emoji (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  name text not null,
  url text not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);
alter table server_emoji enable row level security;
drop policy if exists "server_emoji_read"   on server_emoji;
drop policy if exists "server_emoji_insert" on server_emoji;
drop policy if exists "server_emoji_delete" on server_emoji;
-- Читать — любой участник сервера (это и есть «автоматически доступно при вступлении»).
create policy "server_emoji_read"   on server_emoji for select using (is_member(server_id));
create policy "server_emoji_insert" on server_emoji for insert to authenticated
  with check (is_member(server_id) and created_by = auth.uid());
-- Право «Управление эмодзи» (PERM.MANAGE_EMOJI) проверяется на клиенте (см.
-- ServerSettings.tsx canManageEmoji) — тем же способом, что и остальные права
-- участников в этом приложении (создание каналов, ролей и т.п. тоже не
-- перепроверяются построчно в RLS, только членство).
create policy "server_emoji_delete" on server_emoji for delete to authenticated using (is_member(server_id));

create table if not exists stickers (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  name text not null,
  url text not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);
alter table stickers enable row level security;
drop policy if exists "stickers_read"   on stickers;
drop policy if exists "stickers_insert" on stickers;
drop policy if exists "stickers_delete" on stickers;
create policy "stickers_read"   on stickers for select using (is_member(server_id));
create policy "stickers_insert" on stickers for insert to authenticated
  with check (is_member(server_id) and created_by = auth.uid());
create policy "stickers_delete" on stickers for delete to authenticated using (is_member(server_id));

-- Отправка стикера — как GIF/картинка: вложение сообщения (attach_url/attach_type),
-- просто новое значение attach_type ('sticker') вместо 'image'/'file'/'video'.
-- Новых колонок в messages не нужно (04_storage.sql уже добавил attach_url/attach_type).

alter publication supabase_realtime add table server_emoji;
alter publication supabase_realtime add table stickers;
