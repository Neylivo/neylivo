-- 46_dm_threads_realtime.sql — dm_threads никогда не был добавлен в publication
-- supabase_realtime (в отличие от dm_messages/friend_requests в 02_friends_dm.sql).
-- Следствие: src/lib/badge.ts подписывается на INSERT dm_threads, чтобы кружок
-- непрочитанного на иконке приложения знал о НОВЫХ диалогах — без этой миграции
-- такое событие никогда не долетало, и кружок для только что созданного диалога
-- появлялся лишь после перезапуска приложения (когда список тредов перечитывался заново).
alter publication supabase_realtime add table dm_threads;
