-- v1.282.0: аудит рассинхронов между пользователями — server_events (та же
-- миграция 17_server_settings.sql, что и остальные настройки сервера) вообще
-- не была в публикации realtime. Создал кто-то мероприятие с одного
-- устройства — на другом (открытая панель «Мероприятия») оно не появлялось,
-- пока не переоткроешь панель заново.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_events') then
    alter publication supabase_realtime add table server_events;
  end if;
end $$;
