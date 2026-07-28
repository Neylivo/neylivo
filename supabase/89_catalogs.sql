-- 89: каталог плагинов и каталог ботов (v1.333.0).
--
-- До этого плагин можно было поставить только файлом, который кто-то прислал в
-- чат, а бота — только по id приложения, который надо было где-то узнать. То есть
-- «поделиться своим» означало «найди, кому отправить». Здесь появляется общее
-- место: любой выкладывает своё, любой смотрит и ставит.
--
-- Картинка, короткое описание и имя автора нужны ровно для того, чтобы в списке
-- было понятно, что это, не открывая карточку.

-- ── Каталог плагинов ──────────────────────────────────────────────────────
-- id — тот же, что в шапке .ponoi-файла (@id): плагин с этим id и обновляется,
-- и ставится, поэтому два разных плагина с одинаковым id в каталоге лежать не
-- должны — первый занял, остальным отказ.
create table if not exists public.plugin_catalog (
  id          text primary key,
  name        text not null,
  version     text not null,
  author_id   uuid not null references auth.users on delete cascade,
  author_name text not null,
  summary     text not null,          -- короткое описание, оно же в списке
  description text,                   -- полное, показывается в карточке
  icon_url    text,
  code        text not null,          -- сам .ponoi-файл
  permissions text[] not null default '{}',
  installs    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.plugin_catalog enable row level security;

-- Читать — любому вошедшему: каталог для того и есть. Роль указана намеренно
-- (см. 76_read_requires_login.sql): без неё правило распространяется и на anon.
drop policy if exists "pcat_read" on public.plugin_catalog;
create policy "pcat_read" on public.plugin_catalog for select to authenticated using (true);

-- Выкладывать — от своего имени. author_id подставляет не клиент: см. триггер ниже.
drop policy if exists "pcat_insert" on public.plugin_catalog;
create policy "pcat_insert" on public.plugin_catalog for insert to authenticated
  with check (author_id = auth.uid());

-- Править и снимать — только своё.
drop policy if exists "pcat_update" on public.plugin_catalog;
create policy "pcat_update" on public.plugin_catalog for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "pcat_delete" on public.plugin_catalog;
create policy "pcat_delete" on public.plugin_catalog for delete to authenticated
  using (author_id = auth.uid());

-- ── Каталог ботов ─────────────────────────────────────────────────────────
-- app_id — id приложения из bot_apps: именно его вводят в «Настройки сервера →
-- Боты». В каталоге он лежит открыто и это нормально: по одному id бота нельзя
-- ни угнать, ни выдать себя за него — для этого нужен токен, а он только у
-- владельца (см. 50_bots.sql).
create table if not exists public.bot_catalog (
  app_id      uuid primary key references public.bot_apps on delete cascade,
  name        text not null,
  author_id   uuid not null references auth.users on delete cascade,
  author_name text not null,
  summary     text not null,
  description text,
  icon_url    text,
  adds        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.bot_catalog enable row level security;

drop policy if exists "bcat_read" on public.bot_catalog;
create policy "bcat_read" on public.bot_catalog for select to authenticated using (true);

-- Выложить бота может только его владелец — иначе чужого бота выложил бы кто
-- угодно, а отвечать за него (и получать жалобы) пришлось бы владельцу.
drop policy if exists "bcat_insert" on public.bot_catalog;
create policy "bcat_insert" on public.bot_catalog for insert to authenticated with check (
  author_id = auth.uid()
  and exists (select 1 from public.bot_apps b where b.id = bot_catalog.app_id and b.owner_id = auth.uid())
);

drop policy if exists "bcat_update" on public.bot_catalog;
create policy "bcat_update" on public.bot_catalog for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists "bcat_delete" on public.bot_catalog;
create policy "bcat_delete" on public.bot_catalog for delete to authenticated
  using (author_id = auth.uid());

-- ── Автор и время — от базы, а не от клиента ──────────────────────────────
-- Иначе в каталоге можно было бы выложить плагин «от имени» другого человека:
-- with check выше требует лишь совпадения с auth.uid(), но имя автора и дату
-- клиент присылал бы сам. Имя берём из профиля, дату ставим здесь.
create or replace function public.catalog_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.author_name := coalesce(
      (select coalesce(nullif(p.display_name, ''), p.username) from public.profiles p where p.id = auth.uid()),
      'неизвестен');
    new.created_at := now();
  else
    -- Автора правкой не сменить. Это не только про подделку: счётчик установок
    -- (plugin_installed ниже) — тоже UPDATE, и он выполняется от лица того, кто
    -- ставит плагин. Пока эта строка ставила author_id := auth.uid() всегда,
    -- ПЕРВАЯ же чужая установка делала установившего автором, а настоящий автор
    -- терял право править и снимать своё. Нашлось проверкой в npm run test:db.
    new.author_id := old.author_id;
    new.author_name := case
      when auth.uid() = old.author_id then coalesce(
        (select coalesce(nullif(p.display_name, ''), p.username) from public.profiles p where p.id = auth.uid()),
        old.author_name)
      else old.author_name
    end;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pcat_stamp on public.plugin_catalog;
create trigger pcat_stamp before insert or update on public.plugin_catalog
  for each row execute function public.catalog_stamp();

drop trigger if exists bcat_stamp on public.bot_catalog;
create trigger bcat_stamp before insert or update on public.bot_catalog
  for each row execute function public.catalog_stamp();

-- ── Счётчики установок ────────────────────────────────────────────────────
-- Ставит плагин не автор, а посторонний — значит правом update на чужую строку
-- он не обладает и обладать не должен. Поэтому счётчик двигает функция, и она
-- умеет ровно одно: прибавить единицу.
create or replace function public.plugin_installed(p_id text)
returns void language sql security definer set search_path = public as $$
  update public.plugin_catalog set installs = installs + 1 where id = p_id;
$$;
revoke all on function public.plugin_installed(text) from public;
grant execute on function public.plugin_installed(text) to authenticated;

create or replace function public.bot_added(p_app uuid)
returns void language sql security definer set search_path = public as $$
  update public.bot_catalog set adds = adds + 1 where app_id = p_app;
$$;
revoke all on function public.bot_added(uuid) from public;
grant execute on function public.bot_added(uuid) to authenticated;

-- ── Встроенные боты ───────────────────────────────────────────────────────
-- Бот обычно живёт снаружи: Ponoi шлёт ему события на webhook_url, тот отвечает.
-- У готовых ботов «от нас» никакого снаружи нет и быть не должно — поэтому им
-- ставится вид (kind), и функции bot-dispatch/bot-interact выполняют их сами,
-- никуда не ходя. Пустое значение — обычный бот с вебхуком, как раньше.
alter table public.bot_apps add column if not exists builtin text;

-- Вид встроенного бота задаёт функция создания (сервисный ключ), а не клиент:
-- иначе любой приписал бы своему боту «официальный» вид и получил бы чужую
-- логику под своим именем.
create or replace function public.bot_guard_builtin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.builtin is distinct from old.builtin then
    raise exception 'builtin_is_not_settable';
  end if;
  return new;
end;
$$;

drop trigger if exists bot_guard_builtin on public.bot_apps;
create trigger bot_guard_builtin before update on public.bot_apps
  for each row execute function public.bot_guard_builtin();

-- Список встроенных ботов виден всем вошедшим — по нему рисуется каталог.
-- Пересоздаём вью из 53_bot_apps_public.sql теми же колонками плюс builtin:
-- каталогу нужно знать, встроенный бот или обычный, а секретов тут по-прежнему нет.
drop view if exists public.bot_apps_public;
create view public.bot_apps_public as
  select id, bot_user_id, name, avatar_url, created_at, builtin from public.bot_apps;
grant select on public.bot_apps_public to authenticated;
