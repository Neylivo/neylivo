-- v1.178.0: «Взять тег сервера» — какой сервер сейчас представляет пользователь
-- (тег/цвет/шрифт рядом с ником берутся из servers.settings.tag того сервера).
alter table profiles add column if not exists tag_server_id uuid references servers(id) on delete set null;
