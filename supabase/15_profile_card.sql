-- 15: карточка профиля — местоимения, интеграции, дата регистрации.
alter table profiles add column if not exists pronouns text;
alter table profiles add column if not exists integrations jsonb not null default '[]'::jsonb;
alter table profiles add column if not exists created_at timestamptz not null default now();
