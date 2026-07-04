-- v1.38.0: правила юзернеймов и почты
-- 1) юзернейм уникален (без учёта регистра)
-- 2) 1 почта = 1 аккаунт (проверка перед регистрацией)
-- 3) менять юзернейм можно не чаще раза в 2 недели

alter table public.profiles add column if not exists username_changed_at timestamptz;

-- на случай уже существующих дубликатов: всем, кроме самого раннего, добавляем суффикс
update public.profiles p set username = p.username || '_' || substr(p.id::text, 1, 4)
where exists (
  select 1 from public.profiles q
  where lower(q.username) = lower(p.username) and q.id < p.id
);

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username));

-- Проверка занятости ника (доступна и до входа — для экрана регистрации)
create or replace function public.username_taken(uname text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists(select 1 from public.profiles where lower(username) = lower(uname));
$$;
revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- 1 почта = 1 аккаунт: проверка перед регистрацией
create or replace function public.email_taken(em text)
returns boolean
language sql security definer set search_path = public stable
as $$
  select exists(select 1 from auth.users where lower(email::text) = lower(em));
$$;
revoke all on function public.email_taken(text) from public;
grant execute on function public.email_taken(text) to anon, authenticated;

-- Смена ника не чаще раза в 14 дней (первое заполнение пустого профиля не считается сменой)
create or replace function public.enforce_username_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.username is distinct from old.username and old.username is not null then
    if old.username_changed_at is not null and old.username_changed_at > now() - interval '14 days' then
      raise exception 'username_change_too_soon';
    end if;
    new.username_changed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_username_rules on public.profiles;
create trigger trg_username_rules before update on public.profiles
  for each row execute function public.enforce_username_rules();
