-- 09_soundboard.sql
-- Shared soundboard for Ponoi voice channels: saved audio clips ("Моменты" +
-- uploaded sounds) that everyone can see, play, trim, and blast into a call.
-- Apply in the Supabase SQL Editor AFTER 08_push.sql (data-plane connection
-- cannot run DDL). Audio files themselves live in the existing public
-- `attachments` Storage bucket — no new bucket needed.

create table if not exists public.soundboard_clips (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  name        text not null,
  owner       uuid not null references auth.users(id) on delete cascade,
  owner_name  text,
  duration    real not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.soundboard_clips enable row level security;

-- Everyone signed-in can see all clips (shared soundboard).
drop policy if exists "soundboard_select_all" on public.soundboard_clips;
create policy "soundboard_select_all" on public.soundboard_clips
  for select to authenticated using (true);

-- Anyone signed-in can add a clip they own.
drop policy if exists "soundboard_insert_own" on public.soundboard_clips;
create policy "soundboard_insert_own" on public.soundboard_clips
  for insert to authenticated with check (owner = auth.uid());

-- Only the owner can delete their clip.
drop policy if exists "soundboard_delete_own" on public.soundboard_clips;
create policy "soundboard_delete_own" on public.soundboard_clips
  for delete to authenticated using (owner = auth.uid());

-- Live sync so new clips appear for everyone immediately.
alter publication supabase_realtime add table public.soundboard_clips;