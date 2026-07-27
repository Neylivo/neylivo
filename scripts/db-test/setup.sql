-- Минимальное окружение под миграцию 81: только то, на что она опирается.
-- Определения хелперов скопированы дословно из репозитория, чтобы проверять
-- настоящий код, а не его пересказ.

create schema if not exists auth;
create table auth.users (id uuid primary key);

-- Заглушка auth.uid(): в тесте «кто сейчас» задаётся через set_config('test.uid', ...).
create or replace function auth.uid() returns uuid
language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

create publication supabase_realtime;

create table servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner uuid not null references auth.users on delete cascade,
  base_permissions bigint not null default 0,
  created_at timestamptz not null default now()
);
create table channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  name text not null,
  kind text not null default 'text',
  topic text,
  settings jsonb not null default '{}'::jsonb,
  private_roles uuid[] not null default '{}'
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels on delete cascade,
  author uuid not null references auth.users on delete cascade,
  author_name text not null,
  content text not null,
  attach_url text,
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create table server_members (
  server_id uuid not null references servers on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  member_name text not null,
  role text,
  role_id uuid,
  timeout_until timestamptz,
  primary key (server_id, user_id)
);
create table server_roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references servers on delete cascade,
  name text not null,
  permissions bigint not null default 0,
  position int not null default 1
);
create table member_roles (
  server_id uuid not null references servers on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role_id uuid not null references server_roles on delete cascade,
  primary key (server_id, user_id, role_id)
);

alter table servers        enable row level security;
alter table channels       enable row level security;
alter table messages       enable row level security;
alter table server_members enable row level security;
alter table server_roles   enable row level security;
alter table member_roles   enable row level security;

-- 03_members_invites.sql, дословно
create or replace function is_member(sid uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from server_members m where m.server_id = sid and m.user_id = auth.uid());
$$;

-- 72_harden_permission_functions.sql, дословно
create or replace function server_permissions(p_server uuid, p_user uuid)
returns bigint language sql security definer set search_path = public stable as $$
  select coalesce((select bit_or(sr.permissions) from member_roles mr join server_roles sr on sr.id = mr.role_id
                   where mr.server_id = p_server and mr.user_id = p_user), 0)
       | coalesce((select sr.permissions from server_members sm join server_roles sr on sr.id = sm.role_id
                   where sm.server_id = p_server and sm.user_id = p_user), 0)
       | coalesce((select base_permissions from servers where id = p_server), 0)
$$;

-- 71_fix_channel_privacy_recursion.sql, дословно
create or replace function can_view_channel(p_channel_id uuid, p_user uuid)
returns boolean language sql security definer stable as $$
  select case
    when not coalesce((select (c.settings->>'private')::boolean from channels c where c.id = p_channel_id), false) then true
    else exists (
      select 1 from channels c join servers s on s.id = c.server_id
      where c.id = p_channel_id and (
        s.owner = p_user
        or (server_permissions(s.id, p_user) & 4) <> 0
        or exists (select 1 from member_roles mr where mr.server_id = c.server_id and mr.user_id = p_user and mr.role_id = any(c.private_roles))
        or exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = p_user and sm.role_id = any(c.private_roles))
      )
    )
  end
$$;

create policy "servers_read"   on servers  for select using (true);
create policy "channels_read"  on channels for select using (true);
create policy "messages_read"  on messages for select using (true);
create policy "sm_read"        on server_members for select using (true);
create policy "roles_read"     on server_roles for select using (true);
create policy "mr_read"        on member_roles for select using (true);

create role authenticated;
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function auth.uid() to authenticated;
