-- v1.276.0: срочный фикс — can_view_channel() (миграция 69_channel_privacy.sql)
-- сама читает из таблицы channels, но не помечена security definer. Значит её
-- внутренний SELECT ТОЖЕ проверяется политикой channels_read, которая опять
-- вызывает can_view_channel() — рекурсивная проверка политики на каждой
-- внутренней строке. На проде это выливалось в "canceling statement due to
-- statement timeout" (Postgres 57014) на ЛЮБОЙ выборке из channels —
-- список каналов не грузился вообще ни у кого, старые и новые сервера
-- одинаково. is_member() (миграция 03) для сравнения уже был security
-- definer с самого начала — эту функцию просто забыли пометить так же.
create or replace function can_view_channel(p_channel_id uuid, p_user uuid)
returns boolean language sql security definer stable as $$
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
