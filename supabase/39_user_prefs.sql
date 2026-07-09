-- v1.164.0: приватные персональные настройки жили только в localStorage (заметки о
-- людях, папки серверов, заглушение каналов/серверов, режим уведомлений, приватность
-- сервера, отметки «прочитано», избранные GIF, плейлисты музыки, часть общих настроек) —
-- на другом устройстве всё это выглядело так, будто аккаунт «забыл». Одна строка на
-- пользователя, читать/писать может только он сам (в отличие от profiles — тут не видно
-- никому другому).
create table if not exists user_prefs (
  user_id uuid primary key references auth.users on delete cascade,
  notes jsonb not null default '{}'::jsonb,          -- {targetUserId: text} — приватная заметка о человеке
  srv_folders jsonb not null default '[]'::jsonb,    -- папки серверов в левой колонке
  ch_muted jsonb not null default '{}'::jsonb,       -- {channelId: true} — заглушённые каналы
  srv_notif jsonb not null default '{}'::jsonb,      -- {serverId: 'mentions'|'mute'} — режим уведомлений сервера
  srv_privacy jsonb not null default '{}'::jsonb,    -- {serverId: {dm, activity}} — приватность на сервере
  ch_read jsonb not null default '{}'::jsonb,        -- {channelId: ms} — последнее прочитанное в канале
  dm_read jsonb not null default '{}'::jsonb,        -- {threadId: ms} — последнее прочитанное в ЛС
  gif_favs jsonb not null default '[]'::jsonb,       -- избранные GIF
  mus_playlists jsonb not null default '[]'::jsonb,  -- плейлисты в «Ponoi Music»
  account jsonb not null default '{}'::jsonb,        -- account-level часть настроек (уведомления, ЛС, сбор данных)
  updated_at timestamptz not null default now()
);
alter table user_prefs enable row level security;
drop policy if exists "uprefs_read"   on user_prefs;
drop policy if exists "uprefs_insert" on user_prefs;
drop policy if exists "uprefs_update" on user_prefs;
create policy "uprefs_read"   on user_prefs for select to authenticated using (auth.uid() = user_id);
create policy "uprefs_insert" on user_prefs for insert to authenticated with check (auth.uid() = user_id);
create policy "uprefs_update" on user_prefs for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
