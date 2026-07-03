-- Ponoi — этап 7 миграции: ОБЩИЕ кастом-эмодзи и GIF.
-- Делает кастом-эмодзи и «Мои GIF» видимыми ВСЕМ и с любого устройства
-- (раньше жили только в localStorage). Выполни в Supabase -> SQL Editor
-- ПОСЛЕ 06_shared_state.sql. Новые бакеты Storage не нужны.

-- Общие кастом-эмодзи: :имя: -> картинка. Имя — глобальный ключ.
create table if not exists custom_emoji (
  name text primary key,
  url text not null,
  owner uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

alter table custom_emoji enable row level security;
drop policy if exists "emoji_read"   on custom_emoji;
drop policy if exists "emoji_insert" on custom_emoji;
drop policy if exists "emoji_update" on custom_emoji;
drop policy if exists "emoji_delete" on custom_emoji;
create policy "emoji_read"   on custom_emoji for select using (true);
create policy "emoji_insert" on custom_emoji for insert to authenticated with check (auth.uid() = owner);
-- разрешаем upsert (замену) авторизованным
create policy "emoji_update" on custom_emoji for update to authenticated using (true) with check (auth.uid() = owner);
create policy "emoji_delete" on custom_emoji for delete to authenticated using (true);

-- Общая коллекция GIF («Мои GIF» -> общие GIF)
create table if not exists gifs (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  owner uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

alter table gifs enable row level security;
drop policy if exists "gifs_read"   on gifs;
drop policy if exists "gifs_insert" on gifs;
drop policy if exists "gifs_delete" on gifs;
create policy "gifs_read"   on gifs for select using (true);
create policy "gifs_insert" on gifs for insert to authenticated with check (auth.uid() = owner);
create policy "gifs_delete" on gifs for delete to authenticated using (true);

-- Realtime: новые эмодзи/гифки появляются у всех сразу
alter publication supabase_realtime add table custom_emoji;
alter publication supabase_realtime add table gifs;