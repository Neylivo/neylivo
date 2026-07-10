-- 50_bots.sql — платформа ботов (v1.193.0), часть Б плана. Бот = настоящий
-- auth.users аккаунт (server_members.user_id/messages.author — жёсткие FK на
-- auth.users, обойти нельзя и не нужно — дальше бот пользуется ВСЕМИ существующими
-- механизмами: роли/права/сообщения/RLS как обычный участник). Создаётся один раз
-- сервисной Edge Function bot-create (supabase.auth.admin.createUser).
create table if not exists bot_apps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,    -- разработчик бота
  bot_user_id uuid not null references auth.users on delete cascade, -- сам бот-аккаунт
  name text not null,
  avatar_url text,
  webhook_url text,
  webhook_secret text not null,        -- HMAC-подпись исходящих запросов (X-Ponoi-Signature)
  token_hash text not null,            -- sha256(токен) — сырой токен виден только один раз, при создании
  created_at timestamptz not null default now()
);
alter table bot_apps enable row level security;
create policy "ba_read"  on bot_apps for select to authenticated using (auth.uid() = owner_id);
create policy "ba_write" on bot_apps for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Слэш-команды бота — простые строковые аргументы в v1 (без вложенных типов/подкоманд).
create table if not exists bot_commands (
  id uuid primary key default gen_random_uuid(),
  bot_app_id uuid not null references bot_apps on delete cascade,
  name text not null,
  description text not null,
  options jsonb not null default '[]',   -- [{name, description, required}]
  unique (bot_app_id, name)
);
alter table bot_commands enable row level security;
-- Читать может любой участник сервера (нужно строить автодополнение /команд чужого
-- бота, который стоит на твоём сервере) — писать только владелец приложения.
create policy "bc_read"  on bot_commands for select to authenticated using (true);
create policy "bc_write" on bot_commands for all to authenticated using (
  exists (select 1 from bot_apps a where a.id = bot_app_id and a.owner_id = auth.uid())
) with check (
  exists (select 1 from bot_apps a where a.id = bot_app_id and a.owner_id = auth.uid())
);

-- profiles.is_bot — отличает бот-аккаунт от человека (бейдж «БОТ» в чате, см. src/lib/botTag.ts).
alter table profiles add column if not exists is_bot boolean not null default false;

-- Кто из ботов реально состоит в server_members данного сервера — уже покрыто
-- существующей таблицей server_members (bot_user_id там как обычный user_id),
-- отдельной bot_webhooks-таблицы не заводим: подписки на конкретные типы событий
-- не в v1 (боту прилетают все сообщения серверов, где он состоит).

-- ПОСЛЕ применения этой миграции и деплоя Edge Function bot-dispatch — включить
-- доставку событий: Supabase Dashboard -> Database -> Webhooks -> Create a new
-- hook: table = messages, event = INSERT, тип = Supabase Edge Function, функция
-- = bot-dispatch. Это штатный механизм Supabase для «INSERT в таблице -> вызов
-- Edge Function», отдельный pg_net-триггер писать вручную не нужно.
