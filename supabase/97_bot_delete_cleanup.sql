-- v1.361.0: удалили бота — он уходит и с серверов.
--
-- Что было не так. Бот числится на сервере обычной строкой в server_members, а
-- ссылается она на auth.users, а не на bot_apps. Поэтому удаление приложения
-- бота не задевало членство ни на одном сервере: приложения нет, а участник
-- остался. В списке он висел серым — «не в сети», потому что живым его считает
-- как раз наличие приложения, — и убрать его было уже нечем: кнопка «Убрать
-- бота» ищет бота среди bot_apps, а там пусто.
--
-- Чиним в базе, а не в приложении: удалить бота можно и из настроек, и прямым
-- запросом, и каскадом при удалении учётной записи владельца. Проверка в одном
-- из этих путей оставила бы призраков в остальных.

-- 1) Дальше такого не будет.
create or replace function public.bot_apps_cleanup_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from server_members where user_id = old.bot_user_id;
  return old;
end;
$$;

drop trigger if exists bot_apps_cleanup on public.bot_apps;
create trigger bot_apps_cleanup
  after delete on public.bot_apps
  for each row execute function public.bot_apps_cleanup_members();

-- 2) Те, что уже повисли. Признак призрака точный: профиль помечен как бот, но
--    приложения у него нет ни одного. У живого бота приложение есть всегда —
--    без него он и создан быть не мог.
delete from server_members sm
where exists (select 1 from profiles p where p.id = sm.user_id and p.is_bot)
  and not exists (select 1 from bot_apps b where b.bot_user_id = sm.user_id);
