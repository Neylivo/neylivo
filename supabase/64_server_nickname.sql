-- v1.253.0: настоящий никнейм на сервере — раньше server_members.member_name
-- писался ОДИН РАЗ при вступлении (createServer/joinByCode/redeem_invite) и
-- никогда не обновлялся — даже сменой обычного ника в настройках аккаунта
-- (Settings.tsx меняет только profiles.display_name). Участники месяцами видели
-- друг у друга устаревшие имена в списке участников и автодополнении @упоминаний.
--
-- nickname_override — true, если участник явно задал СВОЙ ник для этого сервера
-- («Изменить ник на сервере» в ServerView.tsx); тогда автосинхронизация обычного
-- ника (Settings.tsx) этот сервер не трогает. false (по умолчанию) — member_name
-- просто зеркалит обычный ник и обновляется автоматически при его смене.
alter table server_members add column if not exists nickname_override boolean not null default false;

-- До сих пор на server_members вообще не было UPDATE-политики — обновить
-- member_name можно было только через миграцию/консоль. Разрешаем участнику
-- обновлять СВОЮ строку, но триггером запрещаем менять что-либо, кроме
-- member_name/nickname_override — иначе тем же UPDATE можно было бы выдать
-- себе role_id чужой (хоть владельческой) роли или снять с себя timeout.
drop policy if exists "sm_update_self" on server_members;
create policy "sm_update_self" on server_members for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function enforce_member_self_edit()
returns trigger language plpgsql as $$
begin
  -- Ограничение действует ТОЛЬКО когда участник правит свою же строку (это и
  -- проверяет новая политика sm_update_self) — security definer функции вроде
  -- timeout_member (49_role_perms2.sql) обновляют ЧУЖУЮ строку от лица админа
  -- (auth.uid() тогда не равен old.user_id — своё разрешение на это они уже
  -- проверяют сами внутри), их это ограничение не касается.
  if auth.uid() = old.user_id and (
       new.role is distinct from old.role
       or new.role_id is distinct from old.role_id
       or new.timeout_until is distinct from old.timeout_until
       or new.joined_at is distinct from old.joined_at
       or new.user_id is distinct from old.user_id
       or new.server_id is distinct from old.server_id
     ) then
    raise exception 'self-edit is limited to member_name/nickname_override';
  end if;
  return new;
end;
$$;

drop trigger if exists sm_update_guard on server_members;
create trigger sm_update_guard before update on server_members
  for each row execute function enforce_member_self_edit();
