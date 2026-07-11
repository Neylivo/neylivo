-- 54_security_hardening.sql — фиксы по итогам security-аудита (Fable 5, v1.200.0).
-- Ничего в UI не меняется, это чисто RLS/RPC на бэкенде. Применить ПОСЛЕ 53.

-- ====== A) КРИТИЧНО: любой пользователь мог вступить на ЛЮБОЙ сервер и читать
-- его целиком, зная только server_id (а server_invites вдобавок отдавал ВСЕ
-- server_id всем подряд — si_read был using(true)). sm_insert проверял только
-- user_id = auth.uid(), без всякой проверки инвайта/членства. sm_insert_not_banned
-- (34_permissions.sql) ничего не чинил: это ВТОРАЯ permissive-политика на INSERT,
-- а permissive-политики объединяются через OR — значит бан обходился тем же путём.
-- Фикс: прямой self-insert разрешён только владельцу при создании СВОЕГО сервера
-- (createServer в src/lib/servers.ts); обычное вступление теперь идёт только
-- через redeem_invite() — security definer, сам ищет server_id по коду (клиенту
-- не нужно да и не positioned читать server_invites), проверяет паузу приглашений
-- и бан, и уже тогда вставляет строку в server_members.
drop policy if exists "sm_insert" on server_members;
drop policy if exists "sm_insert_not_banned" on server_members;
create policy "sm_insert" on server_members for insert to authenticated with check (
  user_id = auth.uid()
  and exists (select 1 from servers s where s.id = server_members.server_id and s.owner = auth.uid())
  and not exists (select 1 from server_bans b where b.server_id = server_members.server_id and b.user_id = auth.uid())
);

drop policy if exists "si_read" on server_invites;
create policy "si_read" on server_invites for select to authenticated using (is_member(server_id));

create or replace function redeem_invite(p_code text, p_member_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_server_id uuid;
  v_paused boolean;
begin
  select server_id into v_server_id from server_invites where code = p_code;
  if v_server_id is null then raise exception 'invite_not_found'; end if;
  select coalesce((settings->>'invites_paused')::boolean, false) into v_paused from servers where id = v_server_id;
  if v_paused then raise exception 'invites_paused'; end if;
  if exists (select 1 from server_bans b where b.server_id = v_server_id and b.user_id = auth.uid()) then
    raise exception 'banned';
  end if;
  insert into server_members (server_id, user_id, member_name, role)
    values (v_server_id, auth.uid(), p_member_name, 'member')
    on conflict (server_id, user_id) do nothing;
  return v_server_id;
end;
$$;
revoke all on function redeem_invite(text, text) from public;
grant execute on function redeem_invite(text, text) to authenticated;

-- ====== B) email_for_username отдавал реальную почту ЛЮБОГО юзернейма ЛЮБОМУ
-- (даже неавторизованному) вызывающему — grant был to anon. Заменён на Edge
-- Function login-by-username (server-side резолв + сам вход, почта не покидает
-- сервер). RPC отзываем у всех — функцию оставляем определённой на случай
-- отката, просто больше никто не может её вызвать.
revoke execute on function public.email_for_username(text) from anon, authenticated;

-- ====== C) «Стена росписи»: wall_insert проверял только author_id = auth.uid(),
-- а image_url был полностью произвольной строкой клиента. Комбинируя с
-- avatars_delete_wall (31_wall_storage_delete.sql, delete по совпадению
-- image_url c именем объекта), можно было завести фейковую запись, чей
-- image_url указывает на ЧУЖОЙ файл в avatars (пути предсказуемы: <uid>/...),
-- и тут же удалить её — удаляется настоящий файл жертвы. Требуем, чтобы
-- image_url реально указывал в папку своего uid, как при обычной загрузке
-- (см. uploadTo() в src/lib/storage.ts — путь всегда <uid>/...).
drop policy if exists "wall insert" on public.wall_drawings;
create policy "wall insert" on public.wall_drawings
  for insert to authenticated with check (
    author_id = auth.uid()
    and image_url like '%/' || auth.uid()::text || '/%'
  );

-- ====== D) Общие кастом-эмодзи/GIF: update/delete были using(true) — ЛЮБОЙ
-- авторизованный мог перепривязать чужой :emoji: на другую картинку или
-- удалить чужой эмодзи/GIF глобально, для всех сразу (шок-контент/грифинг).
-- UI и так уже показывает «Удалить» только владельцу (EmojiPicker.tsx,
-- emojiOwner(ctx.name) === user.id) — это просто подтягивает RLS под то,
-- что интерфейс и планировал.
drop policy if exists "emoji_update" on custom_emoji;
drop policy if exists "emoji_delete" on custom_emoji;
create policy "emoji_update" on custom_emoji for update to authenticated using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "emoji_delete" on custom_emoji for delete to authenticated using (auth.uid() = owner);

drop policy if exists "gifs_delete" on gifs;
create policy "gifs_delete" on gifs for delete to authenticated using (auth.uid() = owner);

-- ====== E) Закрепление сообщения (messages_update_pin/dm_messages_update_pin)
-- разрешало UPDATE целиком, без with check — владелец сервера/участник ЛС
-- с правом только «закрепить» мог на самом деле переписать content/author_name
-- чужого сообщения (подмена текста задним числом). Триггер разрешает менять
-- content/author_name/attach_* только самому автору; остальным (закрепляющим)
-- эти поля остаются равны старым значениям, иначе — ошибка.
create or replace function enforce_pin_only_edit()
returns trigger language plpgsql as $$
begin
  if new.author is distinct from old.author then
    raise exception 'cannot reassign message author';
  end if;
  if old.author <> auth.uid() then
    if new.content is distinct from old.content
       or new.author_name is distinct from old.author_name
       or new.attach_url is distinct from old.attach_url
       or new.attach_type is distinct from old.attach_type then
      raise exception 'only the author can edit message content';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_messages_pin_only on messages;
create trigger trg_messages_pin_only before update on messages
  for each row execute function enforce_pin_only_edit();

drop trigger if exists trg_dm_messages_pin_only on dm_messages;
create trigger trg_dm_messages_pin_only before update on dm_messages
  for each row execute function enforce_pin_only_edit();

-- ====== F) server_events read был using(true) без to authenticated — название,
-- описание, место и время любого мероприятия любого сервера читал кто угодно,
-- даже без аккаунта. insert уже был зафиксирован раньше (36_event_perms.sql);
-- read донастраиваем так же — только участники сервера.
drop policy if exists "server_events read" on server_events;
create policy "server_events read" on server_events for select to authenticated using (is_member(server_id));
