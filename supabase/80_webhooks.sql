-- 80: вебхуки каналов (v1.319.0).
--
-- Что было. В настройках канала есть кнопка «Создать вебхук», которая показывала
-- «Вебхуки скоро появятся». Право «Управление вебхуками» в системе прав при этом
-- уже существовало и даже проверялось в интерфейсе — не хватало самой сути.
--
-- Что это такое. Вебхук — адрес, на который стороннее приложение (сборка на
-- сервере, скрипт, монитор) шлёт обычный POST, и сообщение появляется в канале от
-- заданного имени. То же, что вебхуки Discord.
--
-- Про токен. В базе лежит только его отпечаток (sha256), сам токен показывается
-- ОДИН раз при создании — тот же приём, что у токенов ботов (50_bots.sql). Иначе
-- любой, кто получил доступ к чтению таблицы, получил бы и право писать в канал
-- от имени сервера.

create table if not exists public.webhooks (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid not null references public.channels on delete cascade,
  server_id   uuid not null references public.servers on delete cascade,
  name        text not null,
  avatar_url  text,
  token_hash  text not null,        -- sha256(токен); сырой токен в базе не хранится
  created_by  uuid not null references auth.users on delete cascade,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists webhooks_channel_idx on public.webhooks (channel_id);

alter table public.webhooks enable row level security;

-- Видеть список вебхуков канала может тот, кто вправе ими управлять: владелец
-- сервера, управляющий каналами или носитель права «Управление вебхуками» (16384).
-- Обычному участнику знать о них незачем — это внутренняя механика сервера.
drop policy if exists "wh_read" on public.webhooks;
create policy "wh_read" on public.webhooks for select to authenticated using (
  exists (
    select 1 from public.servers s where s.id = webhooks.server_id and (
      s.owner = auth.uid()
      or (public.server_permissions(s.id, auth.uid()) & 4) <> 0
      or (public.server_permissions(s.id, auth.uid()) & 16384) <> 0
    )
  )
);

drop policy if exists "wh_insert" on public.webhooks;
create policy "wh_insert" on public.webhooks for insert to authenticated with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.channels c
    join public.servers s on s.id = c.server_id
    where c.id = webhooks.channel_id and c.server_id = webhooks.server_id and (
      s.owner = auth.uid()
      or (public.server_permissions(s.id, auth.uid()) & 4) <> 0
      or (public.server_permissions(s.id, auth.uid()) & 16384) <> 0
    )
  )
);

drop policy if exists "wh_delete" on public.webhooks;
create policy "wh_delete" on public.webhooks for delete to authenticated using (
  exists (
    select 1 from public.servers s where s.id = webhooks.server_id and (
      s.owner = auth.uid()
      or (public.server_permissions(s.id, auth.uid()) & 4) <> 0
      or (public.server_permissions(s.id, auth.uid()) & 16384) <> 0
    )
  )
);
