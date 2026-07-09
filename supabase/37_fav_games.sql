-- v1.161.0: любимые игры профиля жили в localStorage (видны только на своём же
-- устройстве владельца, невидимы никому другому) — переносим в profiles, как
-- остальные украшения профиля (about, pronouns, nameplate, ...).
alter table profiles add column if not exists fav_games jsonb not null default '[]'::jsonb;
