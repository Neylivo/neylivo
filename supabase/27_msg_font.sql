-- 27: шрифт сообщений — пресет (CSS font-family) и/или свой загруженный файл шрифта.
alter table profiles add column if not exists msg_font text;
alter table profiles add column if not exists msg_font_url text;
