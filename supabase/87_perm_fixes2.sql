-- 87: права, которые проверялись только в интерфейсе, и захват сервера (v1.330.0).
--
-- Продолжение сверки, начатой в 85. Тогда я прошёл по битам прав и нашёл вебхуки
-- и эмодзи; на этот раз проверял иначе — не «есть ли бит в SQL», а «совпадает ли
-- запрет в базе с тем, что показывает интерфейс». Так нашлось ещё пять мест, и
-- одно из них позволяет отобрать сервер у владельца.

-- ── A) ГЛАВНОЕ: сервер можно было отобрать у владельца ─────────────────────
-- servers_update (49_role_perms2.sql) написана как
--     for update using (auth.uid() = owner or (server_permissions(id, auth.uid()) & 1) <> 0)
-- и БЕЗ with check. Когда with check не указан, Postgres проверяет тем же
-- условием и строку ПОСЛЕ правки — а она условию удовлетворяет, если в ней
-- owner = я. То есть участник с правом «Управление сервером» мог одним запросом
--     update servers set owner = <свой id>
-- сделать сервер своим: настоящий владелец после этого терял всё, включая
-- возможность вернуть себе права, — снять роль может только владелец.
--
-- with check тут не помогает: он не видит старую строку и не может сказать
-- «owner не менялся». Поэтому сторож-триггер — он видит и old, и new.
create or replace function public.servers_guard_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner is distinct from old.owner and auth.uid() is distinct from old.owner then
    raise exception 'only_owner_can_transfer';
  end if;
  return new;
end;
$$;

drop trigger if exists servers_guard_owner on public.servers;
create trigger servers_guard_owner before update on public.servers
  for each row execute function public.servers_guard_owner();

-- ── B) Канал заводил любой участник ───────────────────────────────────────
-- channels_update и channels_delete спрашивают «Управление каналами» (бит 4,
-- 34_permissions.sql), а channels_insert с 03_members_invites.sql так и осталась
-- `with check (is_member(server_id))`. Переименовать и удалить канал участник не
-- мог, а СОЗДАТЬ — мог, мимо интерфейса: кнопка в ServerView.tsx закрыта
-- проверкой canManageChannels, но запрос можно послать и без кнопки.
drop policy if exists "channels_insert" on public.channels;
create policy "channels_insert" on public.channels for insert to authenticated with check (
  exists (select 1 from public.servers s where s.id = channels.server_id and (
    s.owner = auth.uid() or (public.server_permissions(s.id, auth.uid()) & 4) <> 0
  ))
);

-- ── C) «Управление ролями» ролей не создавало ─────────────────────────────
-- roles_insert/update/delete (12_roles.sql) требуют владельца сервера и с тех
-- пор не менялись, хотя право MANAGE_ROLES (бит 2) в интерфейсе есть и вкладка
-- «Роли» по нему открывается (ServerSettings.tsx canManageRolesTab). То же, что
-- было с вебхуками в 85: право показано, база отказывает.
--
-- Просто пустить бит 2 нельзя — получилась бы дыра шире прежней: модератор
-- завёл бы себе роль с «Управлением сервером» и, после A, забрал бы сервер.
-- Поэтому правило как в Discord: раздать можно только то, что есть у тебя.
create or replace function public.can_grant_permissions(p_server uuid, p_user uuid, p_mask bigint)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.servers s where s.id = p_server and s.owner = p_user)
      or ((public.server_permissions(p_server, p_user) & 2) <> 0
          and (p_mask & ~public.server_permissions(p_server, p_user)) = 0);
$$;

revoke all on function public.can_grant_permissions(uuid, uuid, bigint) from public;
grant execute on function public.can_grant_permissions(uuid, uuid, bigint) to authenticated;

drop policy if exists "roles_insert" on public.server_roles;
create policy "roles_insert" on public.server_roles for insert to authenticated
  with check (public.can_grant_permissions(server_id, auth.uid(), permissions));

-- using смотрит на старую строку, with check — на новую. Обе нужны: без первой
-- модератор переписал бы роль, которая сильнее его самого, без второй — дописал
-- бы себе в неё чужие права.
drop policy if exists "roles_update" on public.server_roles;
create policy "roles_update" on public.server_roles for update to authenticated
  using (public.can_grant_permissions(server_id, auth.uid(), permissions))
  with check (public.can_grant_permissions(server_id, auth.uid(), permissions));

drop policy if exists "roles_delete" on public.server_roles;
create policy "roles_delete" on public.server_roles for delete to authenticated
  using (public.can_grant_permissions(server_id, auth.uid(), permissions));

-- ── D) Роль можно было принести с чужого сервера ──────────────────────────
-- mr_insert (49_role_perms2.sql) проверяла право на сервере, но не проверяла,
-- что сама роль принадлежит ЭТОМУ серверу. А server_permissions() складывает
-- права по member_roles, тоже не сверяя server_id роли. Вместе это значит:
-- заведи свой сервер, сделай там роль со всеми битами и выдай её себе на чужом
-- сервере — права сложатся. Правлю оба конца: и политику, и саму функцию.
-- Текст 72_harden_permission_functions.sql, дословно, плюс `and sr.server_id = ...`
-- в обеих половинах: роль засчитывается только на своём сервере.
create or replace function server_permissions(p_server uuid, p_user uuid)
returns bigint language sql security definer set search_path = public stable as $$
  select coalesce((select bit_or(sr.permissions) from member_roles mr join server_roles sr on sr.id = mr.role_id
                   where mr.server_id = p_server and mr.user_id = p_user and sr.server_id = p_server), 0)
       | coalesce((select sr.permissions from server_members sm join server_roles sr on sr.id = sm.role_id
                   where sm.server_id = p_server and sm.user_id = p_user and sr.server_id = p_server), 0)
       | coalesce((select base_permissions from servers where id = p_server), 0)
$$;

create or replace function top_role_position(p_server uuid, p_user uuid)
returns int language sql security definer set search_path = public stable as $$
  select min(pos) from (
    select sr.position as pos from member_roles mr join server_roles sr on sr.id = mr.role_id
      where mr.server_id = p_server and mr.user_id = p_user and sr.server_id = p_server
    union all
    select sr.position from server_members sm join server_roles sr on sr.id = sm.role_id
      where sm.server_id = p_server and sm.user_id = p_user and sr.server_id = p_server
  ) t
$$;

-- Строки, которые могли появиться до этой правки, убираем — иначе запрет
-- касался бы только новых.
delete from public.member_roles mr
 where not exists (select 1 from public.server_roles r
                    where r.id = mr.role_id and r.server_id = mr.server_id);

drop policy if exists "mr_insert" on public.member_roles;
create policy "mr_insert" on public.member_roles for insert to authenticated with check (
  exists (
    select 1 from public.server_roles r
     where r.id = member_roles.role_id
       and r.server_id = member_roles.server_id
       and public.can_grant_permissions(member_roles.server_id, auth.uid(), r.permissions)
  )
);

drop policy if exists "mr_delete" on public.member_roles;
create policy "mr_delete" on public.member_roles for delete to authenticated using (
  exists (
    select 1 from public.server_roles r
     where r.id = member_roles.role_id
       and public.can_grant_permissions(member_roles.server_id, auth.uid(), r.permissions)
  )
);

-- ── E) «Управление событиями» события не создавало ────────────────────────
-- Бит MANAGE_EVENTS (256) в SQL не встречался ни разу: 36_event_perms.sql
-- спрашивает «Управление каналами» (4). Роль с одним только «Управлением
-- событиями» получала отказ, хотя кнопку видела.
drop policy if exists "server_events insert" on public.server_events;
create policy "server_events insert" on public.server_events for insert to authenticated with check (
  auth.uid() = created_by
  and (
    auth.uid() = (select owner from public.servers where id = server_events.server_id)
    or (public.server_permissions(server_events.server_id, auth.uid()) & 4) <> 0
    or (public.server_permissions(server_events.server_id, auth.uid()) & 256) <> 0
  )
);

drop policy if exists "server_events delete" on public.server_events;
create policy "server_events delete" on public.server_events for delete to authenticated using (
  auth.uid() = created_by
  or auth.uid() = (select owner from public.servers where id = server_events.server_id)
  or (public.server_permissions(server_events.server_id, auth.uid()) & 256) <> 0
);

-- ── F) Кастом-эмодзи: имя занимал один, а переписать мог любой ────────────
-- :имя: — глобальный ключ на всё приложение, и приложение это знает: addCustom()
-- в src/lib/emoji.ts прямо отказывает, если имя занято другим человеком. А в
-- базе стояло `update ... using (true)` и `delete ... using (true)`, то есть
-- проверка была только в клиенте. Прямым запросом чужое :имя: подменялось на
-- свою картинку — и она показывалась во всех старых сообщениях, где это эмодзи
-- уже стоит, у всех сразу.
--
-- Ничьи (owner is null — хозяин удалил учётную запись) остаются удаляемыми:
-- иначе их не убрать никогда, а имя останется занятым навсегда.
drop policy if exists "emoji_update" on public.custom_emoji;
create policy "emoji_update" on public.custom_emoji for update to authenticated
  using (owner = auth.uid() or owner is null) with check (owner = auth.uid());

drop policy if exists "emoji_delete" on public.custom_emoji;
create policy "emoji_delete" on public.custom_emoji for delete to authenticated
  using (owner = auth.uid() or owner is null);

-- ── G) Обложки игр: адрес мог быть любым ──────────────────────────────────
-- game_covers — общий кэш, его пишет любой вошедший, и это осознанно: одна игра
-- ищется один раз на всех. Но в поле лежит адрес, который потом грузят ВСЕ
-- клиенты, а ограничения на него не было никакого. Ограничиваю до https://:
-- javascript:, data: и подобное в общий кэш больше не попадёт.
alter table public.game_covers drop constraint if exists game_covers_url_https;
alter table public.game_covers add constraint game_covers_url_https
  check (cover_url is null or cover_url like 'https://%');

-- ── H) Избранные эмодзи не обновлялись живьём ─────────────────────────────
-- src/lib/emoji.ts подписан на изменения emoji_favs и ссылается на миграцию
-- «64_more_realtime_2.sql», которой в репозитории нет и никогда не было: таблицу
-- в публикацию realtime так и не добавили. Подписка молчала, звёздочка на втором
-- устройстве не появлялась. В changelog v1.253.0 это записано как исправленное —
-- запись была неправдой.
do $$ begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'emoji_favs') then
    alter publication supabase_realtime add table public.emoji_favs;
  end if;
end $$;
