-- 43: «Игровой Экспресс» (QuickLaunch) — сборки Minecraft, которыми можно
-- поделиться в чате. Список модов может быть большим (сотни записей), поэтому
-- живёт отдельной таблицей, а не в самом сообщении (как sysInvite) — сообщение
-- несёт только id пака + лёгкое превью (игра/версия/число модов).

create table if not exists public.quicklaunch_packs (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  game text not null default 'minecraft',
  mc_version text not null,
  loader text not null default 'forge',
  loader_version text not null,
  server_ip text not null,
  server_port int not null default 25565,
  mods jsonb not null default '[]'::jsonb,  -- [{name, filename, sha1, size}]
  created_at timestamptz not null default now()
);

alter table public.quicklaunch_packs enable row level security;

-- Читать может кто угодно авторизованный — получатель карточки в чате ещё не
-- «участник» ничего, ему просто прислали пак, как и с приглашением на сервер.
drop policy if exists "quicklaunch_packs read" on public.quicklaunch_packs;
create policy "quicklaunch_packs read" on public.quicklaunch_packs
  for select to authenticated using (true);

drop policy if exists "quicklaunch_packs insert" on public.quicklaunch_packs;
create policy "quicklaunch_packs insert" on public.quicklaunch_packs
  for insert to authenticated with check (host_id = auth.uid());

drop policy if exists "quicklaunch_packs delete" on public.quicklaunch_packs;
create policy "quicklaunch_packs delete" on public.quicklaunch_packs
  for delete to authenticated using (host_id = auth.uid());
