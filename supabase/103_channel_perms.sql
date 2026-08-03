-- v1.443.0: права НА КАНАЛ — переопределения для ролей и отдельных участников.
--
-- Что было. У канала была карта channels.settings->'perms' вида
-- «ключ → allow/deny/default», общая на всех и работавшая ровно для одного
-- права (отправка сообщений, см. v1.316.0 и 78_channel_readonly.sql). То есть
-- «настроить канал под конкретную роль» было нельзя: либо право есть на всём
-- сервере, либо его нет нигде.
--
-- Как теперь, и это то же самое, что в Discord:
--   • у канала есть перекрытия: для @everyone, для любой роли и для конкретного
--     участника; каждое — пара «что разрешить» и «что запретить»;
--   • считается так: права сервера → перекрытие @everyone → перекрытия всех
--     ролей человека (сначала все запреты, потом все разрешения) → перекрытие
--     самого человека. Порядок важен: именно он даёт «роли запрещено, а лично
--     ему можно»;
--   • владелец сервера и обладатель «Управление каналами» перекрытиями не
--     ограничиваются — иначе можно закрыть себе вход в собственный канал и
--     остаться без способа это починить изнутри приложения.
--
-- ВАЖНО про то, как это встроено. Политика messages_insert НЕ переобъявляется:
-- в ней накопились условия из семи миграций (тайм-аут, вложения, согласие с
-- правилами, уровень проверки, ветки), и переписывание её «с нуля» тихо
-- отбрасывает часть из них. Я это сделал в первой версии этой же миграции и
-- поймал на проверках: восемь ранее проходивших упали разом. Поэтому меняются
-- только ФУНКЦИИ, которые политика и так зовёт: channel_can_send и
-- can_view_channel.
--
-- Хранение — jsonb: { "everyone": {"a": 0, "d": 2097152}, "<uuid роли>": {...},
-- "u:<uuid участника>": {...} }.
--
-- ПРО БИТЫ КАНАЛА. Права здесь ПОЛОЖИТЕЛЬНЫЕ: чтобы писать, бит должен быть, а
-- запрет его снимает. Первую версию я написал наоборот — «запрет = поставить
-- бит», — и она молча ничего не запрещала: снимать было нечего, потому что на
-- уровне сервера таких битов нет вовсе. Поймал это на проверках: перекрытие
-- сохранялось, а писать по-прежнему могли все.
--
--   1048576 (CH_VIEW) — видеть канал;
--   2097152 (CH_SEND) — писать в канал.
--
-- Оба выданы по умолчанию всем: канал без перекрытий ведёт себя ровно так, как
-- вёл до этой миграции.

alter table channels add column if not exists perm_overrides jsonb not null default '{}'::jsonb;

comment on column channels.perm_overrides is
  'Перекрытия прав канала: { "everyone"|"<roleId>"|"u:<userId>": {"a": разрешить, "d": запретить} }';

-- Число из перекрытия: мусор считаем нулём, а не «разрешить всё».
create or replace function public.ov_bits(p_row jsonb, p_key text)
returns bigint language sql immutable as $$
  select case
    when p_row is null then 0
    when jsonb_typeof(p_row -> p_key) = 'number' then (p_row ->> p_key)::bigint
    else 0
  end
$$;

-- Итоговые права человека В КАНАЛЕ.
create or replace function public.channel_permissions(p_channel uuid, p_user uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare
  v_server uuid; v_owner uuid; v_ov jsonb; v_perm bigint;
  v_allow bigint := 0; v_deny bigint := 0; v_row jsonb; v_role uuid;
begin
  select c.server_id, s.owner, coalesce(c.perm_overrides, '{}'::jsonb)
    into v_server, v_owner, v_ov
    from channels c join servers s on s.id = c.server_id
   where c.id = p_channel;
  if v_server is null then return 0; end if;

  -- Права сервера ПЛЮС канальные биты, выданные по умолчанию: видеть и писать.
  v_perm := server_permissions(v_server, p_user) | 1048576 | 2097152;

  -- Владелец и управляющий каналами — вне перекрытий (см. вступление).
  if p_user = v_owner or (v_perm & 4) <> 0 then return v_perm; end if;

  v_row := v_ov -> 'everyone';
  v_perm := (v_perm & ~ov_bits(v_row, 'd')) | ov_bits(v_row, 'a');

  -- Все роли человека: сначала собираем, потом применяем — иначе порядок ролей
  -- в выборке менял бы итог, а он не должен.
  for v_role in
    select mr.role_id from member_roles mr where mr.server_id = v_server and mr.user_id = p_user
    union
    select sm.role_id from server_members sm where sm.server_id = v_server and sm.user_id = p_user and sm.role_id is not null
  loop
    v_row := v_ov -> v_role::text;
    v_deny := v_deny | ov_bits(v_row, 'd');
    v_allow := v_allow | ov_bits(v_row, 'a');
  end loop;
  v_perm := (v_perm & ~v_deny) | v_allow;

  -- Лично этот участник — последним словом.
  v_row := v_ov -> ('u:' || p_user::text);
  v_perm := (v_perm & ~ov_bits(v_row, 'd')) | ov_bits(v_row, 'a');

  return v_perm;
end;
$$;

revoke all on function public.channel_permissions(uuid, uuid) from public;
grant execute on function public.channel_permissions(uuid, uuid) to authenticated;

-- Отправка: прежнее правило «канал только для чтения» остаётся как было, плюс
-- запрет перекрытием — бит 2097152 (существует только на уровне канала).
create or replace function public.channel_can_send(p_channel uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select
    -- 1. Перекрытие: право писать в этом канале должно быть на месте.
    (channel_permissions(p_channel, p_user) & 2097152) <> 0
    and case
      when coalesce((select c.settings -> 'perms' ->> 'send' from public.channels c where c.id = p_channel), 'default') <> 'deny'
        then true
      else exists (
        select 1 from public.channels c join public.servers s on s.id = c.server_id
        where c.id = p_channel and (
          s.owner = p_user
          or (public.server_permissions(s.id, p_user) & 32) <> 0
          or (public.server_permissions(s.id, p_user) & 4) <> 0
        )
      )
    end
$$;

revoke all on function public.channel_can_send(uuid, uuid) from public;
grant execute on function public.channel_can_send(uuid, uuid) to authenticated;

-- Видимость: прежнее правило (приватный канал + список ролей) остаётся, плюс
-- запрет перекрытием — бит 1048576.
create or replace function public.can_view_channel(p_channel_id uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select case
    when coalesce((select (c.settings->>'private')::boolean from public.channels c where c.id = p_channel_id), false)
      and not exists (
        select 1 from public.channels c join public.servers s on s.id = c.server_id
        where c.id = p_channel_id and (
          s.owner = p_user
          or (public.server_permissions(s.id, p_user) & 4) <> 0
          or exists (select 1 from public.member_roles mr where mr.server_id = c.server_id and mr.user_id = p_user and mr.role_id = any(c.private_roles))
          or exists (select 1 from public.server_members sm where sm.server_id = c.server_id and sm.user_id = p_user and sm.role_id = any(c.private_roles))
        )
      )
    then false
    else (public.channel_permissions(p_channel_id, p_user) & 1048576) <> 0
  end
$$;

revoke all on function public.can_view_channel(uuid, uuid) from public;
grant execute on function public.can_view_channel(uuid, uuid) to authenticated;
