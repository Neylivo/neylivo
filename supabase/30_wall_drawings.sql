-- 30_wall_drawings.sql — «Стена росписи» на профиле (v1.146.0)
-- На профиле каждого пользователя есть общая стена, куда любой участник может
-- добавить рисунок (PNG в бакете avatars). Рисунки видны всем (realtime).
-- Удалять рисунок может его автор ИЛИ владелец стены (хозяин профиля).
create table if not exists public.wall_drawings (
  id uuid primary key default gen_random_uuid(),
  wall_user_id uuid not null,
  author_id uuid not null default auth.uid(),
  author_name text,
  image_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists wall_drawings_wall_idx on public.wall_drawings (wall_user_id, created_at desc);

alter table public.wall_drawings enable row level security;

drop policy if exists "wall read" on public.wall_drawings;
create policy "wall read" on public.wall_drawings
  for select to authenticated using (true);

drop policy if exists "wall insert" on public.wall_drawings;
create policy "wall insert" on public.wall_drawings
  for insert to authenticated with check (author_id = auth.uid());

drop policy if exists "wall delete" on public.wall_drawings;
create policy "wall delete" on public.wall_drawings
  for delete to authenticated using (author_id = auth.uid() or wall_user_id = auth.uid());

alter publication supabase_realtime add table public.wall_drawings;
