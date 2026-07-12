-- v1.259.0: режим уведомлений отдельного канала (как в Discord) — раньше канал можно
-- было только заглушить целиком (ch_muted), теперь можно явно выбрать «Все сообщения»
-- или «Только упоминания» для конкретного канала, даже если на сервере выбран другой
-- режим (см. src/lib/chNotify.ts, mirror паттерна srv_notif из миграции 39).
alter table user_prefs add column if not exists ch_notif jsonb not null default '{}'::jsonb; -- {channelId: 'all'|'mentions'|'mute'} — отсутствие ключа = наследует режим сервера
