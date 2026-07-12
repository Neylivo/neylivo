-- v1.267.0: приватные каналы — раньше вкладка «Права канала» (ChannelSettings.tsx)
-- сохраняла переключатель «Приватный канал» и tri-state права в channels.settings,
-- но ничего нигде не проверялось: channels_read пускал любого участника сервера
-- читать ЛЮБОЙ канал независимо от private. Теперь private-канал реально виден
-- только владельцу/MANAGE_CHANNELS и ролям из private_roles.
alter table channels add column if not exists private_roles uuid[] not null default '{}';

create or replace function can_view_channel(p_channel_id uuid, p_user uuid)
returns boolean language sql stable as $$
  select case
    when not coalesce((select (c.settings->>'private')::boolean from channels c where c.id = p_channel_id), false) then true
    else exists (
      select 1 from channels c join servers s on s.id = c.server_id
      where c.id = p_channel_id and (
        s.owner = p_user
        or (server_permissions(s.id, p_user) & 4) <> 0   -- MANAGE_CHANNELS
        or exists (select 1 from member_roles mr where mr.server_id = c.server_id and mr.user_id = p_user and mr.role_id = any(c.private_roles))
        or exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = p_user and sm.role_id = any(c.private_roles))
      )
    )
  end
$$;

drop policy if exists "channels_read" on channels;
create policy "channels_read" on channels for select using (is_member(server_id) and can_view_channel(id, auth.uid()));

drop policy if exists "messages_read" on messages;
create policy "messages_read" on messages for select using (
  exists (select 1 from channels c where c.id = messages.channel_id and is_member(c.server_id))
  and can_view_channel(messages.channel_id, auth.uid())
);

-- messages_insert — тот же текст, что в 49_role_perms2.sql (тайм-аут/ATTACH_FILES),
-- плюс can_view_channel в конце.
drop policy if exists "messages_insert" on messages;
create policy "messages_insert" on messages for insert with check (
  author = auth.uid() and exists (
    select 1 from channels c where c.id = messages.channel_id and is_member(c.server_id)
    and not exists (select 1 from server_members sm where sm.server_id = c.server_id and sm.user_id = auth.uid()
                     and sm.timeout_until is not null and sm.timeout_until > now())
    and (messages.attach_url is null or exists (
      select 1 from servers s where s.id = c.server_id and (s.owner = auth.uid() or (server_permissions(s.id, auth.uid()) & 8192) <> 0)
    ))
  ) and can_view_channel(messages.channel_id, auth.uid())
);
