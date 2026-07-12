-- v1.251.0: channels — ещё одна таблица (в компанию к profiles/user_prefs/servers
-- из 51_realtime_sync.sql), которую забыли добавить в публикацию supabase_realtime.
-- Без этого правки в ChannelSettings.tsx (медленный режим, «канал с возрастным
-- ограничением», имя, тема, права и т.д.) не долетали живым событием до тех, у кого
-- сервер уже открыт на другом устройстве/вкладке — обновлялось только у того, кто
-- сам сохранил (см. onChanged={() => loadChannels()} в ServerView.tsx), остальные
-- видели старые настройки, пока не перезайдут на сервер. Особенно заметно стало
-- с v1.248.0 (медленный режим/NSFW реально заработали) — раньше это было
-- незаметно, т.к. сохранённая-но-неприменяемая галочка ни на что не влияла.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'channels') then
    alter publication supabase_realtime add table channels;
  end if;
end $$;
