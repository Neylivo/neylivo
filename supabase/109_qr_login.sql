-- v1.541.0: вход по коду с телефона.
--
-- Владелец: «добавь заход в аккаунт по QR-коду с компа на телефон или наоборот
-- — когда надо через ПК зайти, а залогинен в телефоне, можно отсканировать и
-- без пароля зайдёшь».
--
-- КАК ЭТО УСТРОЕНО. Компьютер, на котором никто не вошёл, создаёт заявку и
-- показывает её QR-кодом. Телефон, где человек уже вошёл, читает код, спрашивает
-- «это правда ты?» и кладёт в заявку СВОЮ сессию — зашифрованную. Компьютер её
-- забирает и оказывается внутри. Пароль при этом не набирается нигде.
--
-- ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ: сессии в открытом виде. В таблице лежит только
-- шифротекст. Ключ, которым его можно открыть, не бывает на сервере ни секунды:
-- компьютер делает одноразовую пару ключей, ОТКРЫТУЮ половину печатает прямо в
-- QR-код, и телефон шифрует ею. Тот, кто читает базу, видит набор байтов.
--
-- ПОЧЕМУ ОТКРЫТЫЙ КЛЮЧ ИМЕННО В QR, А НЕ В БАЗЕ. Если бы телефон брал ключ из
-- базы, сервер мог бы подсунуть свой — и прочитать сессию, оставшись
-- незамеченным. Ключ едет по единственному пути, который сервер не
-- контролирует: с экрана компьютера в камеру телефона.
--
-- ПОЧЕМУ ТАБЛИЦА ЗАКРЫТА ЦЕЛИКОМ. Заявку создаёт тот, кто ещё не вошёл, то есть
-- аноним. Дать анониму читать таблицу — значит отдать список всех ожидающих
-- входов кому угодно. Поэтому политик нет вовсе, а работа идёт через четыре
-- функции, каждая из которых отвечает ровно на один вопрос и только про ту
-- заявку, чей код спросили.
--
-- Применять один раз в Supabase → SQL Editor.

create table if not exists public.login_requests (
  -- Секрет из QR хранится ОТПЕЧАТКОМ, а не как есть: тот, кто получил базу, не
  -- должен уметь одобрить чужую заявку.
  code_hash   text primary key,
  -- Открытая половина одноразового ключа компьютера. Лежит здесь только чтобы
  -- телефон мог сверить её с той, что прочитал из QR: не сойдётся — значит
  -- заявку подменили, и телефон откажется.
  pc_pub      text not null,
  -- Что показать человеку на телефоне: «Windows, NeyLivo для компьютера».
  device      text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- Заполняет телефон при подтверждении.
  approved_at timestamptz,
  phone_pub   text,
  sealed_iv   text,
  sealed_ct   text,
  -- Забрать сессию можно один раз. Второй заход получит пустоту.
  claimed     boolean not null default false
);

alter table public.login_requests enable row level security;
-- Политик нет намеренно: прямого доступа к таблице нет ни у кого.

create index if not exists login_requests_expires_idx on public.login_requests(expires_at);

-- ── Уборка ──────────────────────────────────────────────────────────────────
-- Заявка живёт две минуты. Просроченные удаляются при каждом обращении: это
-- дешевле расписания и не оставляет мусора, если расписание не настроили.
create or replace function public.login_qr_sweep() returns void
language sql security definer set search_path = public as $$
  delete from public.login_requests where expires_at < now() - interval '5 minutes';
$$;

-- ── 1. Компьютер создаёт заявку ─────────────────────────────────────────────
create or replace function public.login_qr_start(p_code_hash text, p_pc_pub text, p_device text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.login_qr_sweep();
  if length(p_code_hash) < 32 or length(p_pc_pub) < 32 then
    raise exception 'плохая заявка';
  end if;
  insert into public.login_requests(code_hash, pc_pub, device, expires_at)
  values (p_code_hash, p_pc_pub, coalesce(p_device, ''), now() + interval '2 minutes')
  on conflict (code_hash) do nothing;
end;
$$;

-- ── 2. Телефон смотрит, что за заявка ───────────────────────────────────────
-- Отдаёт только описание устройства и открытый ключ — чтобы человек понимал,
-- что подтверждает, а телефон мог сверить ключ с прочитанным из QR.
create or replace function public.login_qr_info(p_code_hash text)
returns table (pc_pub text, device text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'нужен вход'; end if;
  return query
    select r.pc_pub, r.device, r.expires_at
    from public.login_requests r
    where r.code_hash = p_code_hash and r.expires_at > now() and r.approved_at is null;
end;
$$;

-- ── 3. Телефон подтверждает и кладёт запечатанную сессию ────────────────────
create or replace function public.login_qr_approve(
  p_code_hash text, p_phone_pub text, p_iv text, p_ct text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare ок boolean;
begin
  if auth.uid() is null then raise exception 'нужен вход'; end if;
  update public.login_requests
     set approved_at = now(), phone_pub = p_phone_pub, sealed_iv = p_iv, sealed_ct = p_ct
   where code_hash = p_code_hash and expires_at > now() and approved_at is null;
  get diagnostics ок = row_count;
  return ок;
end;
$$;

-- ── 4. Компьютер забирает ───────────────────────────────────────────────────
-- Забрать можно ровно один раз: сразу помечаем забранной. Иначе тот, кто
-- подсмотрел QR через плечо, вошёл бы следом вторым.
create or replace function public.login_qr_claim(p_code_hash text)
returns table (phone_pub text, sealed_iv text, sealed_ct text)
language plpgsql security definer set search_path = public as $$
begin
  return query
    update public.login_requests r
       set claimed = true
     where r.code_hash = p_code_hash
       and r.approved_at is not null
       and r.claimed = false
       and r.expires_at > now()
    returning r.phone_pub, r.sealed_iv, r.sealed_ct;
end;
$$;

revoke all on function public.login_qr_sweep() from public;
grant execute on function public.login_qr_start(text, text, text) to anon, authenticated;
grant execute on function public.login_qr_info(text) to authenticated;
grant execute on function public.login_qr_approve(text, text, text, text) to authenticated;
grant execute on function public.login_qr_claim(text) to anon, authenticated;
