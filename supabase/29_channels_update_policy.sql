
-- 29_channels_update_policy.sql — права на изменение/удаление каналов (v1.140.0)
-- До этой миграции на таблице channels не было RLS-политик UPDATE и DELETE:
-- «Сохранить» в настройках канала молча обновлял 0 строк, и настройки терялись
-- (на servers политика была с миграций 06/18 — потому серверные настройки сохранялись).
-- Изменять канал может владелец сервера или роль с флагом «Управление сервером»,
-- удалять — только владелец (как в UI).
drop policy if exists "channels_update" on channels;
create policy "channels_update" on channels for update using (
  exists (
    select 1 from servers s
    where s.id = channels.server_id and (
      s.owner = auth.uid()
      or exists (
        select 1 from server_members sm
        join server_roles sr on sr.id = sm.role_id
        where sm.server_id = s.id and sm.user_id = auth.uid() and sr.manage
      )
    )
  )
);
drop policy if exists "channels_delete" on channels;
create policy "channels_delete" on channels for delete using (
  exists (select 1 from servers s where s.id = channels.server_id and s.owner = auth.uid())
);
