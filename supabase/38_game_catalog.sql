-- v1.162.0: «Любимая игра» как в Discord — вместо ручного ввода названия,
-- пикер со списком игр, в которые реально играли пользователи Ponoi (activity_sessions
-- уже открыта на чтение всем, см. 14_activity_history.sql — агрегируем поверх неё).
create or replace function game_catalog(p_query text default null, p_limit int default 60)
returns table(name text, players bigint, last_played timestamptz)
language sql stable as $$
  select name, count(distinct user_id) as players, max(started_at) as last_played
  from activity_sessions
  where p_query is null or p_query = '' or name ilike '%' || p_query || '%'
  group by name
  order by players desc, last_played desc
  limit p_limit
$$;
