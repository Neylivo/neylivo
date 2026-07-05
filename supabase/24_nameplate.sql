-- 24: «кубик» профиля (nameplate, v1.95.0) — фон (фото/видео до 5 сек) и обводка
--     панельки с ником и аватаркой (панель внизу слева + строка в списке участников).
--     Выполнить в Supabase SQL Editor. До миграции клиент откатывается на старые колонки.
alter table public.profiles add column if not exists nameplate_url text;
alter table public.profiles add column if not exists nameplate_kind text;
alter table public.profiles add column if not exists nameplate_outline text;
