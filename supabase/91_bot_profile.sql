-- 91: профиль бота и счётчики каталога (v1.340.0).
--
-- Бот в Ponoi — обычный участник с настоящей учётной записью, но выглядел он
-- всегда одинаково: буква вместо аватарки и пустой профиль. Поменять это не мог
-- никто, включая владельца бота: правило profiles_update пускает только к своей
-- строке (auth.uid() = id), а строка бота принадлежит боту, а не человеку.
-- Поэтому — функция: она проверяет, что зовущий и есть владелец приложения.

create or replace function public.set_bot_profile(
  p_app uuid, p_avatar text, p_about text, p_primary text, p_accent text
) returns void language plpgsql security definer set search_path = public as $$
declare v_bot uuid;
begin
  -- Владелец приложения — и только он. Иначе чужому боту можно было бы
  -- поставить любую аватарку и текст, а отвечать за это пришлось бы владельцу.
  select bot_user_id into v_bot from public.bot_apps
   where id = p_app and owner_id = auth.uid();
  if v_bot is null then raise exception 'not_your_bot'; end if;

  -- Цвета — только шестнадцатеричные: сюда идёт строка от клиента, а попадает
  -- она в стиль карточки профиля у всех, кто её откроет.
  if p_primary is not null and p_primary !~ '^#[0-9a-fA-F]{6}$' then raise exception 'bad_color'; end if;
  if p_accent  is not null and p_accent  !~ '^#[0-9a-fA-F]{6}$' then raise exception 'bad_color'; end if;
  -- Аватарка — только https: адрес грузят все, кто увидит бота.
  if p_avatar is not null and p_avatar <> '' and p_avatar !~ '^https://' then raise exception 'bad_avatar'; end if;

  update public.profiles set
    avatar_url    = nullif(p_avatar, ''),
    about         = nullif(left(coalesce(p_about, ''), 300), ''),
    primary_color = coalesce(p_primary, primary_color),
    accent_color  = coalesce(p_accent, accent_color)
   where id = v_bot;

  -- Аватарка дублируется в bot_apps: её показывает каталог, который про
  -- учётную запись бота ничего не знает.
  update public.bot_apps set avatar_url = nullif(p_avatar, '') where id = p_app;
end;
$$;

revoke all on function public.set_bot_profile(uuid, text, text, text, text) from public;
grant execute on function public.set_bot_profile(uuid, text, text, text, text) to authenticated;

-- ── Счётчики установок для всего каталога ─────────────────────────────────
-- До этого счётчик жил колонкой в самой строке каталога. У готовых плагинов и
-- ботов «от нас» такой строки нет вовсе — они лежат в сборке, — поэтому под
-- ними не было ни числа, ни хотя бы нуля. Отдельная таблица знает и про них.
create table if not exists public.catalog_stats (
  kind     text not null check (kind in ('plugin', 'bot')),
  ref      text not null,          -- id плагина или id приложения бота
  installs integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (kind, ref)
);

alter table public.catalog_stats enable row level security;

drop policy if exists "cstats_read" on public.catalog_stats;
create policy "cstats_read" on public.catalog_stats for select to authenticated using (true);
-- Писать напрямую нельзя вообще никому: счётчик двигает только функция ниже,
-- и она умеет ровно одно — прибавить единицу.

create or replace function public.catalog_installed(p_kind text, p_ref text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind not in ('plugin', 'bot') then raise exception 'bad_kind'; end if;
  insert into public.catalog_stats (kind, ref, installs, updated_at)
       values (p_kind, left(p_ref, 200), 1, now())
  on conflict (kind, ref) do update set installs = catalog_stats.installs + 1, updated_at = now();

  -- Прежние счётчики в самих строках каталога продолжают жить: на них уже
  -- смотрят выложенные карточки, и терять накопленное незачем.
  if p_kind = 'plugin' then
    update public.plugin_catalog set installs = installs + 1 where id = p_ref;
  else
    begin
      update public.bot_catalog set adds = adds + 1 where app_id = p_ref::uuid;
    exception when invalid_text_representation then null;   -- встроенный бот, не uuid
    end;
  end if;
end;
$$;

revoke all on function public.catalog_installed(text, text) from public;
grant execute on function public.catalog_installed(text, text) to authenticated;
