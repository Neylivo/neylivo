-- Ponoi — этап 8 миграции: web-push подписки.
-- Хранит push-подписки браузеров, чтобы Edge Function send-push могла
-- доставлять уведомления, даже когда приложение/вкладка закрыты.
-- Выполни в Supabase -> SQL Editor ПОСЛЕ 07_shared_emoji_gifs.sql.

create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
-- Пользователь управляет только своими подписками.
-- (Edge Function send-push использует service-role ключ и обходит RLS для чтения чужих подписок при рассылке.)
drop policy if exists "push_select" on push_subscriptions;
drop policy if exists "push_insert" on push_subscriptions;
drop policy if exists "push_update" on push_subscriptions;
drop policy if exists "push_delete" on push_subscriptions;
create policy "push_select" on push_subscriptions for select to authenticated using (auth.uid() = user_id);
create policy "push_insert" on push_subscriptions for insert to authenticated with check (auth.uid() = user_id);
create policy "push_update" on push_subscriptions for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "push_delete" on push_subscriptions for delete to authenticated using (auth.uid() = user_id);