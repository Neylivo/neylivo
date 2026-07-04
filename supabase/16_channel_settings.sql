-- 16_channel_settings.sql — типы каналов (текст/голос) и настройки канала (v1.24.0)
-- kind: 'text' | 'voice'; topic — тема текстового канала;
-- settings — jsonb с настройками (медленный режим, битрейт, права и т.д.)
alter table channels add column if not exists kind text not null default 'text';
alter table channels add column if not exists topic text;
alter table channels add column if not exists settings jsonb not null default '{}'::jsonb;