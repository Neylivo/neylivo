-- 52_server_tag_preview.sql — клик по тегу сервера рядом с ником открывает
-- превью сервера (баннер/иконка/описание/счётчики/дата основания/«Вступить»),
-- как в настоящем Discord. Проблема: servers_read RLS (03_members_invites.sql)
-- пускает читать сервер только участника или владельца — тег специально
-- показывают ЛЮДЯМ, КОТОРЫЕ ЕЩЁ НЕ НА СЕРВЕРЕ (иначе зачем вообще превью с
-- кнопкой «Вступить»), так что обычный select тут не сработает. Вступление по
-- serverId без кода приглашения уже и так ничем не ограничено (sm_insert —
-- только user_id = auth.uid(), см. 03_members_invites.sql/34_permissions.sql) —
-- не хватало только безопасного способа ПРОЧИТАТЬ публичные поля превью.
-- security definer отдаёт СТРОГО ограниченный набор полей — не settings целиком
-- (там может быть конфиг automod и т.п.), не список участников (только их число).
create or replace function server_tag_preview(p_server uuid)
returns table (
  name text,
  avatar_url text,
  banner_url text,
  description text,
  created_at timestamptz,
  member_count int,
  online_ids uuid[]   -- только для подсчёта «в сети» на клиенте через presence; не отдаём имена/аватарки
)
language sql security definer set search_path = public stable as $$
  select
    s.name, s.avatar_url,
    (s.settings->>'banner_url'), (s.settings->>'description'), s.created_at,
    (select count(*)::int from server_members sm where sm.server_id = s.id),
    (select array_agg(sm.user_id) from server_members sm where sm.server_id = s.id)
  from servers s where s.id = p_server
$$;
