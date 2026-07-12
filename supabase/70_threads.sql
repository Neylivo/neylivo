-- v1.268.0: реальные ветки (Threads) — раньше панель «Ветки» (ServerView.tsx,
-- thr-panel) была честной заглушкой: список всегда пустой, «Создать» просто
-- показывало тост «скоро появятся». Сообщения веток живут в ТОЙ ЖЕ таблице
-- messages (с новым thread_id) — так ветки бесплатно получают закреп/реакции/
-- правку/вложения, ничего не дублируя; RLS на messages их уже покрывает,
-- потому что channel_id ветки — это channel_id её родительского канала.
create table if not exists threads (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels on delete cascade,
  server_id uuid not null references servers on delete cascade,
  name text not null,
  created_by uuid not null,
  created_by_name text not null,
  origin_message_id uuid references messages on delete set null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
alter table threads enable row level security;

drop policy if exists "threads_read" on threads;
create policy "threads_read" on threads for select to authenticated using (is_member(server_id));
drop policy if exists "threads_insert" on threads;
create policy "threads_insert" on threads for insert to authenticated with check (is_member(server_id) and created_by = auth.uid());
drop policy if exists "threads_update" on threads;
create policy "threads_update" on threads for update to authenticated using (is_member(server_id));

alter table messages add column if not exists thread_id uuid references threads on delete cascade;

alter publication supabase_realtime add table threads;
