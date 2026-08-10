-- v1.535.0: доверенные устройства и код восстановления.
--
-- Владелец просил защиту уровня Steam: вход с нового устройства не даёт сразу
-- делать опасное, на старые устройства приходит оповещение, а на крайний случай
-- есть код восстановления, который знает только владелец.
--
-- ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: кода восстановления в открытом виде. Хранится
-- только его отпечаток (SHA-256). Иначе тот, кто добрался до базы, получил бы
-- главный ключ от всех аккаунтов разом — а весь смысл кода в том, что он есть
-- ТОЛЬКО у человека, на бумажке.
--
-- Применять один раз в Supabase → SQL Editor. Требует 107_account_guard.sql.

-- ── Устройства, с которых входили ───────────────────────────────────────────
create table if not exists public.trusted_devices (
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_id   text not null,
  label       text default '',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  -- Человек подтвердил «это я». До подтверждения устройство считается новым.
  trusted     boolean not null default false,
  primary key (user_id, device_id)
);

alter table public.trusted_devices enable row level security;

-- Своё видно и правится только своим владельцем. Чужой список устройств —
-- это карта того, где человек бывает, и отдавать его нельзя никому.
drop policy if exists "devices own" on public.trusted_devices;
create policy "devices own" on public.trusted_devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists trusted_devices_seen_idx on public.trusted_devices(user_id, last_seen desc);

-- ── Код восстановления ──────────────────────────────────────────────────────
create table if not exists public.recovery_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- Только отпечаток. Самого кода на сервере не бывает никогда.
  fingerprint text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

alter table public.recovery_codes enable row level security;

-- Свою строку человек может создать и заменить (выпустить новый код), но
-- ПРОЧИТАТЬ отпечаток ему незачем: код он хранит сам, а сверка идёт сравнением.
drop policy if exists "recovery write own" on public.recovery_codes;
create policy "recovery write own" on public.recovery_codes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Сверка кода ─────────────────────────────────────────────────────────────
--
-- Отдельной функцией, чтобы сравнение шло на сервере: клиент присылает
-- отпечаток, а не код, и в ответ получает только «да» или «нет».
create or replace function public.check_recovery_code(fp text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  ok boolean;
begin
  if me is null then
    return false;
  end if;
  select (fingerprint = fp) into ok from public.recovery_codes where user_id = me;
  if coalesce(ok, false) then
    update public.recovery_codes set used_at = now() where user_id = me;
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.check_recovery_code(text) from public;
grant execute on function public.check_recovery_code(text) to authenticated;
