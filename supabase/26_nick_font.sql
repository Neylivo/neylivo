-- 26: шрифт ника — пресет (CSS font-family) и/или свой загруженный файл шрифта.
alter table profiles add column if not exists nick_font text;
alter table profiles add column if not exists nick_font_url text;
