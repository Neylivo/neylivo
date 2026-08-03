-- v1.451.0: право «Управление автомодерацией» начинает что-то значить.
--
-- Что было. Право есть в списке ролей (PERM.MANAGE_AUTOMOD, бит 32768), интерфейс
-- по нему пускает во вкладку «Автомод» — а настройки автомода лежат в
-- servers.settings, и правило servers_update пускает туда только владельца и
-- «Управление сервером». То есть человек с этим правом заходил во вкладку,
-- менял фильтры, нажимал сохранить — и база молча не обновляла ни строки.
-- Право, которое ничего не даёт, хуже отсутствия права: оно обещает.
--
-- Почему нельзя просто добавить бит в правило. Тогда обладатель «управления
-- автомодерацией» смог бы менять В СЕРВЕРЕ ВСЁ — имя, значок, любые настройки:
-- правила доступа Postgres работают на строку целиком, а не на отдельное поле.
-- Это было бы не доделкой права, а раздачей прав владельца.
--
-- Как сделано. Правило пускает, а сторож-триггер следит, что человек с ОДНИМ
-- лишь этим правом меняет ровно одну вещь — settings->'automod'. Любая другая
-- правка той же строки отклоняется с понятной причиной. Владельца и
-- «Управление сервером» сторож не касается: у них и так есть право на всё.
--
-- Тот же приём, что и у сторожа владельца из 87_perm_fixes2.sql: только триггер
-- видит и старую строку, и новую, а значит может сказать «изменилось не то».

drop policy if exists "servers_update" on servers;
create policy "servers_update" on servers for update using (
  auth.uid() = owner
  or (server_permissions(id, auth.uid()) & 1) <> 0
  -- v1.451.0: и автомодерация — что именно ей позволено, решает сторож ниже.
  or (server_permissions(id, auth.uid()) & 32768) <> 0
);

create or replace function public.servers_guard_automod()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_perm bigint;
begin
  -- Владельца не трогаем.
  if auth.uid() = old.owner then return new; end if;
  v_perm := server_permissions(old.id, auth.uid());
  -- «Управление сервером» — полный доступ к строке, как и было.
  if (v_perm & 1) <> 0 then return new; end if;
  -- Дальше — только тот, кто прошёл сюда по праву на автомодерацию.
  if (v_perm & 32768) = 0 then return new; end if;

  -- Ему можно менять ровно одно: settings->'automod'. Всё остальное в строке
  -- обязано остаться прежним — включая прочие ключи настроек.
  if new.name is distinct from old.name
     or new.owner is distinct from old.owner
     or (coalesce(new.settings, '{}'::jsonb) - 'automod')
        is distinct from (coalesce(old.settings, '{}'::jsonb) - 'automod') then
    raise exception 'automod_only';
  end if;
  return new;
end;
$$;

drop trigger if exists servers_guard_automod on servers;
create trigger servers_guard_automod before update on servers
  for each row execute function public.servers_guard_automod();
