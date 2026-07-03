-- 11: «Был в сети» — метка последнего визита пользователя.
-- Обновляется автоматически раз в минуту, пока приложение открыто.
alter table public.profiles add column if not exists last_seen timestamptz;
