-- v1.37.0: вход по юзернейму
-- Функция отдаёт почту по юзернейму (без учёта регистра), чтобы клиент мог
-- выполнить обычный вход по почте+паролю, когда пользователь ввёл ник.
create or replace function public.email_for_username(uname text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.email::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(uname)
  limit 1;
$$;

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated;
