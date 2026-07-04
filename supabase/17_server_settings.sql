-- 17_server_settings.sql — настройки сервера (полноэкранные «Настройки сервера») + события сервера.
-- Применить в Supabase SQL Editor.

-- Все настройки сервера (профиль, тег, вовлечённость, эмодзи/стикеры/звуки,
-- доступ, безопасность, автомод, сообщество, шаблон) лежат в одном jsonb.
alter table servers add column if not exists settings jsonb not null default '{}'::jsonb;

-- Мероприятия сервера.
create table if not exists server_events (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers(id) on delete cascade,
  title text not null,
  description text,
  place text,                -- 'voice' | 'other'
  channel_id uuid,           -- голосовой канал, если place = 'voice'
  location text,             -- произвольное место, если place = 'other'
  starts_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table server_events enable row level security;

drop policy if exists "server_events read" on server_events;
create policy "server_events read" on server_events for select using (true);

drop policy if exists "server_events insert" on server_events;
create policy "server_events insert" on server_events for insert with check (auth.uid() = created_by);

drop policy if exists "server_events delete" on server_events;
create policy "server_events delete" on server_events for delete using (auth.uid() = created_by);