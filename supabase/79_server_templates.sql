-- 79: шаблоны серверов (v1.318.0).
--
-- Что было. Вкладка «Шаблон сервера» существовала, кнопка «Создать шаблон»
-- сохраняла название и описание, и рядом честно висело: «ссылка для клонирования
-- не создаётся». То есть обещание в описании («другой пользователь создаст новый
-- сервер с такими же каналами и ролями») не выполнялось ничем.
--
-- Здесь появляется настоящий шаблон: снимок устройства сервера и код, по которому
-- любой может собрать себе такой же.
--
-- Что копируется: каналы (название, тип, тема, настройки) и роли (название, цвет,
-- права, порядок). Что НЕ копируется и не должно: сообщения, участники, ссылки на
-- картинки и приватность каналов — приватность завязана на конкретные роли чужого
-- сервера, и перенос её вслепую открыл бы у нового владельца то, что он открывать
-- не собирался.

create table if not exists public.server_templates (
  code        text primary key,
  server_id   uuid references public.servers on delete set null,
  author      uuid not null references auth.users on delete cascade,
  name        text not null,
  description text,
  -- {"channels":[{name,kind,topic,settings}], "roles":[{name,color,position,permissions}], "settings":{}}
  snapshot    jsonb not null,
  uses        int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.server_templates enable row level security;

-- Читать может любой вошедший: код шаблона для того и раздают. Без этого нельзя
-- было бы применить чужой шаблон, ради чего всё и делается.
drop policy if exists "tpl_read" on public.server_templates;
create policy "tpl_read" on public.server_templates
  for select to authenticated using (true);

-- Создавать и менять — только свои и только за себя.
drop policy if exists "tpl_insert" on public.server_templates;
create policy "tpl_insert" on public.server_templates
  for insert to authenticated with check (author = auth.uid());

drop policy if exists "tpl_update" on public.server_templates;
create policy "tpl_update" on public.server_templates
  for update to authenticated using (author = auth.uid()) with check (author = auth.uid());

drop policy if exists "tpl_delete" on public.server_templates;
create policy "tpl_delete" on public.server_templates
  for delete to authenticated using (author = auth.uid());

-- Применение шаблона. Делается функцией с правами определившего, а не набором
-- запросов от клиента, по двум причинам: создание сервера с каналами и ролями
-- должно быть одной неделимой операцией (иначе при обрыве связи у человека
-- останется пустой сервер без каналов), и счётчик использований не должен
-- зависеть от того, что клиент решит его увеличить.
create or replace function public.apply_template(p_code text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tpl    public.server_templates;
  v_server uuid;
  v_item   jsonb;
  v_name   text;
begin
  select * into v_tpl from public.server_templates where code = p_code;
  if v_tpl is null then
    raise exception 'Шаблон не найден — проверь код';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then v_name := v_tpl.name; end if;

  insert into public.servers (name, owner) values (left(v_name, 100), auth.uid())
  returning id into v_server;

  -- Владелец сразу становится участником: без этого он не увидит собственный
  -- сервер, потому что все правила доступа опираются на членство.
  insert into public.server_members (server_id, user_id)
  values (v_server, auth.uid())
  on conflict do nothing;

  for v_item in select * from jsonb_array_elements(coalesce(v_tpl.snapshot -> 'roles', '[]'::jsonb)) loop
    insert into public.server_roles (server_id, name, color, position, permissions)
    values (
      v_server,
      left(coalesce(v_item ->> 'name', 'Роль'), 60),
      coalesce(v_item ->> 'color', '#99aab5'),
      coalesce((v_item ->> 'position')::int, 0),
      coalesce((v_item ->> 'permissions')::int, 0)
    );
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(v_tpl.snapshot -> 'channels', '[]'::jsonb)) loop
    insert into public.channels (server_id, name, kind, topic, settings)
    values (
      v_server,
      left(coalesce(v_item ->> 'name', 'канал'), 100),
      v_item ->> 'kind',
      v_item ->> 'topic',
      coalesce(v_item -> 'settings', '{}'::jsonb)
    );
  end loop;

  update public.server_templates set uses = uses + 1 where code = p_code;
  return v_server;
end;
$$;

revoke all on function public.apply_template(text, text) from public;
grant execute on function public.apply_template(text, text) to authenticated;
