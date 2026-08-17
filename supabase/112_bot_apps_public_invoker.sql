-- 112_bot_apps_public_invoker.sql (v1.563.0)
--
-- Заметка Advisor: «Security Definer View — public.bot_apps_public».
-- К падению сервера 16.08.2026 (402, кончился трафик) она отношения не имеет и
-- сегодня ничего не раскрывает: во вью перечислены только безопасные колонки.
-- Но заметка справедлива по сути, и вот почему.
--
-- ЧТО НЕ ТАК. Вью без `security_invoker` выполняется правами СВОЕГО ВЛАДЕЛЬЦА,
-- а владелец — роль, применяющая миграции, и она обходит RLS. Значит вью видит
-- в bot_apps все строки. Сейчас это ровно то, что нужно (см. 53 и 89: список
-- ботов на сервере обязан показывать чужих ботов). Опасно другое: стоит однажды
-- дописать в select колонку `token_hash` или `webhook_secret` — и они молча
-- утекут всем вошедшим, потому что RLS вью не остановит. Заметка предупреждает
-- не о сегодняшней дыре, а о завтрашней описке.
--
-- ПОЧЕМУ НЕЛЬЗЯ ПРОСТО ВКЛЮЧИТЬ security_invoker. Тогда вью пойдёт под правами
-- смотрящего, а на bot_apps висит политика "ba_read" (auth.uid() = owner_id) —
-- человек увидит только СВОИХ ботов. Вкладка «Боты» в настройках сервера и
-- автодополнение /команд сломались бы: боты почти всегда чужие.
--
-- ПОЧЕМУ НЕЛЬЗЯ ЗАКРЫТЬ КОЛОНКИ ГРАНТАМИ. Права на колонку выдаются РОЛИ, а не
-- строке. Открой `webhook_url` роли authenticated ради владельца бота — его
-- увидят все и у всех ботов. Права владельца и права постороннего колонками не
-- различаются, а RLS различает строки, но не колонки. Ни то ни другое в
-- одиночку задачу не решает.
--
-- ЧТО СДЕЛАНО. Обход RLS вынесен из вью в функцию с явным списком колонок:
--
--   • функция security definer — она и видит все строки;
--   • тип возврата у неё ЗАКРЫТЫЙ: секретных колонок в нём нет, и дописать их
--     мимоходом в select нельзя — не сойдётся сигнатура, и миграция упадёт;
--   • вью теперь security_invoker: под правами смотрящего, и обходить RLS ей
--     больше нечего — она читает функцию, а не таблицу.
--
-- Приложение не меняется ни строкой: имя вью, колонки и права те же.
--
-- Запускать можно повторно.

begin;

-- Порядок важен: вью зависит от функции, поэтому сначала снимаем вью.
drop view if exists public.bot_apps_public;
drop function if exists public.bot_apps_public_rows();

-- search_path задан жёстко: без него та же Advisor ругается уже на функцию
-- («Function Search Path Mutable»), и не зря — у security definer подменённый
-- search_path означает выполнение чужого кода с чужими правами.
create function public.bot_apps_public_rows()
returns table (
  id uuid,
  bot_user_id uuid,
  name text,
  avatar_url text,
  created_at timestamptz,
  builtin text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.bot_user_id, b.name, b.avatar_url, b.created_at, b.builtin
  from public.bot_apps b;
$$;

-- По умолчанию execute на функцию достаётся роли public — то есть и анониму.
-- Снимаем и выдаём поимённо: список ботов не для невошедших.
revoke all on function public.bot_apps_public_rows() from public;
grant execute on function public.bot_apps_public_rows() to authenticated;

create view public.bot_apps_public with (security_invoker = on) as
  select id, bot_user_id, name, avatar_url, created_at, builtin
  from public.bot_apps_public_rows();

grant select on public.bot_apps_public to authenticated;

commit;
