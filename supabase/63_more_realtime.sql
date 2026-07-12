-- v1.252.0: ещё три таблицы, пропущенные при добавлении в публикацию
-- supabase_realtime (та же история, что у channels в 62_channels_realtime.sql
-- и у profiles/user_prefs/servers в 51_realtime_sync.sql):
--   • blocked_users   — блокировка/разблокировка на одном устройстве не пряталась/
--     не возвращала переписку на другом, пока не перезайдёшь (src/lib/block.ts).
--   • server_bans     — список банов во вкладке «Баны» настроек сервера не
--     обновлялся, если забанили/разбанили с другого устройства.
--   • server_invites  — то же самое для вкладки «Приглашения».
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'blocked_users') then
    alter publication supabase_realtime add table blocked_users;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_bans') then
    alter publication supabase_realtime add table server_bans;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_invites') then
    alter publication supabase_realtime add table server_invites;
  end if;
end $$;
