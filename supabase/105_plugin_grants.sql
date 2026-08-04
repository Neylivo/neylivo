-- 105: личная передача плагина (v1.468.0).
--
-- Зачем. Отдать свой плагин можно было двумя способами: выложить в общий каталог
-- или прислать файлом в чат. Первое не годится, когда плагин не для всех —
-- сделан на заказ или продан одному человеку. Второе не даёт ничего, кроме
-- файла: ни следа, кому отдано, ни возможности отозвать, ни ограничения «одному
-- и только один раз». Автор вынужден просто выкладывать файл в переписку и
-- надеяться.
--
-- Что здесь. Передача — это КОД. Автор заводит передачу своего плагина, получает
-- короткий код и отдаёт его тому, кому надо. Передачу можно привязать к
-- конкретному человеку, ограничить числом получений и сроком, а потом посмотреть,
-- кто её забрал, и отозвать.
--
-- ЧЕСТНО О ТОМ, ЧЕГО ЭТО НЕ ДЕЛАЕТ.
--
-- Это не защита от копирования, и обещать её нельзя. Плагин — обычный
-- JavaScript, который выполняется у человека на устройстве; получив его, он
-- видит весь код и может передать файл дальше кому угодно. Никакая проверка на
-- нашей стороне этому не помешает, и любой, кто скажет обратное, обманет.
-- Передача даёт другое: адресность (код работает у названного человека),
-- ограниченность (одно получение, срок) и СЛЕД — видно, кто и когда забрал.
-- Об этом прямо сказано и в самом приложении, на экране передачи.
--
-- Устройство. Сама таблица закрыта наглухо: читать её может только автор своих
-- же передач. Получатель к таблице не обращается вовсе — он зовёт функцию
-- claim_plugin_grant, и она (и только она) отдаёт содержимое, проверив код,
-- адресата, срок и остаток получений.
--
-- Проверки: scripts/db-test/rls-test.mjs (npm run test:db).

create table if not exists public.plugin_grants (
  id uuid primary key default gen_random_uuid(),
  -- Код длинный нарочно: он и есть пропуск. Двенадцать знаков из
  -- неоднозначного алфавита без 0/O/1/I — перебрать нельзя.
  code text not null unique,
  author uuid not null references auth.users(id) on delete cascade,
  -- Кому предназначено. NULL — «любому, у кого есть код»: так тоже надо, когда
  -- заранее неизвестно, с какого аккаунта человек придёт.
  to_user uuid references auth.users(id) on delete set null,
  -- Что передаётся. kind оставлен на вырост: сейчас это только плагин-файл,
  -- но набор команд простого бота — такие же переносимые данные, и заводить
  -- ради них вторую таблицу с той же механикой было бы ошибкой.
  kind text not null default 'plugin',
  plugin_id text not null,
  plugin_name text not null,
  plugin_version text not null default '',
  -- Сам файл. Предел тот же, что и у установки в приложении (512 КБ):
  -- проверка на стороне базы, потому что клиент здесь не единственный вход.
  payload text not null,
  -- Записка для себя: кому и за что. Видит только автор.
  note text default '',
  uses_left int not null default 1,
  expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.plugin_grants drop constraint if exists plugin_grants_payload_len;
alter table public.plugin_grants add constraint plugin_grants_payload_len
  check (char_length(payload) between 1 and 524288);
alter table public.plugin_grants drop constraint if exists plugin_grants_uses;
alter table public.plugin_grants add constraint plugin_grants_uses
  check (uses_left >= 0 and uses_left <= 1000);
alter table public.plugin_grants drop constraint if exists plugin_grants_kind;
alter table public.plugin_grants add constraint plugin_grants_kind
  check (kind in ('plugin', 'bot'));
alter table public.plugin_grants drop constraint if exists plugin_grants_code_len;
alter table public.plugin_grants add constraint plugin_grants_code_len
  check (char_length(code) between 8 and 64);
alter table public.plugin_grants drop constraint if exists plugin_grants_note_len;
alter table public.plugin_grants add constraint plugin_grants_note_len
  check (char_length(coalesce(note, '')) <= 300);

create index if not exists plugin_grants_author_idx on public.plugin_grants(author, created_at desc);

-- Кто забрал. Отдельной таблицей, а не полем: получений может быть несколько, и
-- автору важно видеть каждое — это и есть «след», ради которого всё затевалось.
create table if not exists public.plugin_grant_claims (
  grant_id uuid not null references public.plugin_grants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (grant_id, user_id)
);

alter table public.plugin_grants enable row level security;
alter table public.plugin_grant_claims enable row level security;

-- Таблица передач закрыта: её видит только автор своих же строк. Получатель
-- сюда не ходит вовсе — ему отвечает функция ниже.
drop policy if exists "pg_read_own" on public.plugin_grants;
create policy "pg_read_own" on public.plugin_grants for select
  using (auth.uid() = author);

drop policy if exists "pg_insert_own" on public.plugin_grants;
create policy "pg_insert_own" on public.plugin_grants for insert
  with check (auth.uid() = author);

-- Правка своей передачи — это отзыв и смена остатка. Автора менять нельзя:
-- иначе чужую передачу можно было бы записать на себя.
drop policy if exists "pg_update_own" on public.plugin_grants;
create policy "pg_update_own" on public.plugin_grants for update
  using (auth.uid() = author) with check (auth.uid() = author);

drop policy if exists "pg_delete_own" on public.plugin_grants;
create policy "pg_delete_own" on public.plugin_grants for delete
  using (auth.uid() = author);

-- Записи о получении: автор видит все свои, человек — свои собственные.
-- Писать их напрямую нельзя никому: их ставит только функция получения.
drop policy if exists "pgc_read" on public.plugin_grant_claims;
create policy "pgc_read" on public.plugin_grant_claims for select
  using (
    auth.uid() = user_id
    or exists (select 1 from public.plugin_grants g where g.id = grant_id and g.author = auth.uid())
  );

/**
 * Получить плагин по коду.
 *
 * Единственная дверь для получателя: сама таблица ему закрыта. Функция
 * security definer, то есть работает мимо правил доступа, — поэтому каждое
 * условие здесь надо перечитать дважды.
 *
 * Повторный вызов ТЕМ ЖЕ человеком получение не расходует. Это не мелочь: после
 * получения приложение показывает экран разрешений, и человек может отказаться.
 * Расходуй мы получение сразу и навсегда — единственная попытка сгорала бы на
 * его же осторожности, а автор об этом даже не узнал бы.
 */
create or replace function public.claim_plugin_grant(p_code text)
returns table (
  kind text, plugin_id text, plugin_name text, plugin_version text,
  payload text, author uuid
)
language plpgsql security definer set search_path = public as $$
declare
  g public.plugin_grants%rowtype;
  v_me uuid := auth.uid();
  v_already boolean;
begin
  if v_me is null then
    raise exception 'Нужно войти в аккаунт';
  end if;

  select * into g from public.plugin_grants where code = p_code;
  -- Про несуществующий и отозванный код говорим одинаково: подсказывать
  -- перебирающему, что код «был, но отозван», незачем.
  if not found or g.revoked then
    raise exception 'Код не найден';
  end if;
  if g.expires_at is not null and g.expires_at < now() then
    raise exception 'Срок передачи истёк';
  end if;
  -- Именная передача — только названному человеку. Здесь причина говорится
  -- прямо: у него код уже есть, скрывать нечего, а «код не найден» отправило бы
  -- его искать несуществующую ошибку.
  if g.to_user is not null and g.to_user <> v_me then
    raise exception 'Эта передача предназначена другому человеку';
  end if;
  if g.author = v_me then
    raise exception 'Это твоя же передача — плагин у тебя и так есть';
  end if;

  select exists(
    select 1 from public.plugin_grant_claims c where c.grant_id = g.id and c.user_id = v_me
  ) into v_already;

  if not v_already then
    if g.uses_left <= 0 then
      raise exception 'Передачу уже забрали';
    end if;
    update public.plugin_grants set uses_left = uses_left - 1 where id = g.id;
    insert into public.plugin_grant_claims(grant_id, user_id) values (g.id, v_me);
  end if;

  return query select g.kind, g.plugin_id, g.plugin_name, g.plugin_version, g.payload, g.author;
end $$;

revoke all on function public.claim_plugin_grant(text) from public;
grant execute on function public.claim_plugin_grant(text) to authenticated;

/**
 * Посмотреть, что за передача, НЕ забирая её.
 *
 * Нужно для честного экрана: человек должен видеть, что именно ему предлагают,
 * до того как соглашаться. Сам файл отсюда не уходит — только название и автор.
 */
create or replace function public.peek_plugin_grant(p_code text)
returns table (kind text, plugin_id text, plugin_name text, plugin_version text, author uuid, mine boolean)
language plpgsql security definer set search_path = public as $$
declare
  g public.plugin_grants%rowtype;
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Нужно войти в аккаунт'; end if;
  select * into g from public.plugin_grants where code = p_code;
  if not found or g.revoked then raise exception 'Код не найден'; end if;
  if g.expires_at is not null and g.expires_at < now() then raise exception 'Срок передачи истёк'; end if;
  if g.to_user is not null and g.to_user <> v_me then
    raise exception 'Эта передача предназначена другому человеку';
  end if;
  return query select g.kind, g.plugin_id, g.plugin_name, g.plugin_version, g.author, (g.author = v_me);
end $$;

revoke all on function public.peek_plugin_grant(text) from public;
grant execute on function public.peek_plugin_grant(text) to authenticated;
