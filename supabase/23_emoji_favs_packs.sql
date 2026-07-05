-- Ponoi — этап 23 миграции: ИЗБРАННЫЕ эмодзи и ПАКИ эмодзи.
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 22_music_meta.sql.
--
-- 1) emoji_favs: личное «избранное» — каждый пользователь может добавить
--    туда ЛЮБОЙ кастом-эмодзи (в том числе чужой).
-- 2) emoji_packs + emoji_pack_items: паки эмодзи; пак видят все,
--    создаёт/удаляет — владелец.
-- 3) Удалять кастом-эмодзи теперь может только его владелец.

create table if not exists emoji_favs (
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, name)
);
alter table emoji_favs enable row level security;
drop policy if exists "efavs_read"   on emoji_favs;
drop policy if exists "efavs_insert" on emoji_favs;
drop policy if exists "efavs_delete" on emoji_favs;
create policy "efavs_read"   on emoji_favs for select using (auth.uid() = user_id);
create policy "efavs_insert" on emoji_favs for insert to authenticated with check (auth.uid() = user_id);
create policy "efavs_delete" on emoji_favs for delete to authenticated using (auth.uid() = user_id);

create table if not exists emoji_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table emoji_packs enable row level security;
drop policy if exists "epacks_read"   on emoji_packs;
drop policy if exists "epacks_insert" on emoji_packs;
drop policy if exists "epacks_update" on emoji_packs;
drop policy if exists "epacks_delete" on emoji_packs;
create policy "epacks_read"   on emoji_packs for select using (true);
create policy "epacks_insert" on emoji_packs for insert to authenticated with check (auth.uid() = owner);
create policy "epacks_update" on emoji_packs for update to authenticated using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "epacks_delete" on emoji_packs for delete to authenticated using (auth.uid() = owner);

create table if not exists emoji_pack_items (
  pack_id uuid not null references emoji_packs on delete cascade,
  name text not null,
  primary key (pack_id, name)
);
alter table emoji_pack_items enable row level security;
drop policy if exists "epitems_read"   on emoji_pack_items;
drop policy if exists "epitems_insert" on emoji_pack_items;
drop policy if exists "epitems_delete" on emoji_pack_items;
create policy "epitems_read"   on emoji_pack_items for select using (true);
create policy "epitems_insert" on emoji_pack_items for insert to authenticated
  with check (exists (select 1 from emoji_packs p where p.id = pack_id and p.owner = auth.uid()));
create policy "epitems_delete" on emoji_pack_items for delete to authenticated
  using (exists (select 1 from emoji_packs p where p.id = pack_id and p.owner = auth.uid()));

-- Ужесточение: удалять кастом-эмодзи может только владелец (раньше — кто угодно).
drop policy if exists "emoji_delete" on custom_emoji;
create policy "emoji_delete" on custom_emoji for delete to authenticated using (auth.uid() = owner);

-- Realtime: паки появляются у всех сразу.
alter publication supabase_realtime add table emoji_packs;
alter publication supabase_realtime add table emoji_pack_items;
