-- 93: картинка-шапка в профиле (v1.349.0).
--
-- Шапка профиля до этого была только двумя цветами: карточка рисовала градиент
-- от primary к accent. Для человека это выбор в настройках, а бот выглядел
-- совсем бедно — у него и цвета-то выставлял владелец вслепую.
--
-- Колонка общая, не «для ботов»: карточка профиля одна и та же, и городить
-- отдельное поле только под ботов значило бы иметь два разных профиля вместо
-- одного. Кто и как её заполняет — вопрос интерфейса, а не хранения.
alter table public.profiles add column if not exists banner_url text;

-- ── Профиль бота: добавляем шапку ─────────────────────────────────────────
-- Прежняя функция из 91 остаётся на месте (её зовут старые сборки), а эта берёт
-- на один параметр больше. Проверки те же: владелец, https, цвета.
create or replace function public.set_bot_profile(
  p_app uuid, p_avatar text, p_about text, p_primary text, p_accent text, p_banner text
) returns void language plpgsql security definer set search_path = public as $$
declare v_bot uuid;
begin
  select bot_user_id into v_bot from public.bot_apps
   where id = p_app and owner_id = auth.uid();
  if v_bot is null then raise exception 'not_your_bot'; end if;

  if p_primary is not null and p_primary !~ '^#[0-9a-fA-F]{6}$' then raise exception 'bad_color'; end if;
  if p_accent  is not null and p_accent  !~ '^#[0-9a-fA-F]{6}$' then raise exception 'bad_color'; end if;
  -- Оба адреса грузят все, кто увидит бота, — значит только https.
  if p_avatar is not null and p_avatar <> '' and p_avatar !~ '^https://' then raise exception 'bad_avatar'; end if;
  if p_banner is not null and p_banner <> '' and p_banner !~ '^https://' then raise exception 'bad_banner'; end if;

  update public.profiles set
    avatar_url    = nullif(p_avatar, ''),
    banner_url    = nullif(p_banner, ''),
    about         = nullif(left(coalesce(p_about, ''), 300), ''),
    primary_color = coalesce(p_primary, primary_color),
    accent_color  = coalesce(p_accent, accent_color)
   where id = v_bot;

  update public.bot_apps set avatar_url = nullif(p_avatar, '') where id = p_app;
end;
$$;

revoke all on function public.set_bot_profile(uuid, text, text, text, text, text) from public;
grant execute on function public.set_bot_profile(uuid, text, text, text, text, text) to authenticated;
