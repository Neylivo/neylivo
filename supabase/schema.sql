-- Ponoi — схема БД для Supabase.
-- Выполни это в Supabase Dashboard -> SQL Editor.

create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null,
  avatar_color text
);

create table if not exists servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  name text not null
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels on delete cascade,
  author uuid not null references auth.users on delete cascade,
  author_name text not null,
  content text not null,
  created_at timestamptz not null default now()
);

-- Row Level Security
alter table profiles enable row level security;
alter table servers  enable row level security;
alter table channels enable row level security;
alter table messages enable row level security;

-- Политики (простой вариант для личного/доверенного круга.
-- Позже ужесточим через таблицы участников server_members).
create policy "profiles_read"   on profiles for select using (true);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

create policy "servers_read"   on servers for select using (true);
create policy "servers_insert" on servers for insert with check (auth.uid() = owner);
create policy "servers_delete" on servers for delete using (auth.uid() = owner);

create policy "channels_read"   on channels for select using (true);
create policy "channels_insert" on channels for insert with check (true);

create policy "messages_read"   on messages for select using (true);
create policy "messages_insert" on messages for insert with check (auth.uid() = author);

-- Realtime: включаем стрим INSERT по messages
alter publication supabase_realtime add table messages;
