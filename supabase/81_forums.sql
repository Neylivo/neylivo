-- 81: форумы (v1.320.0).
--
-- Что было. В модалке «Создать канал» четвёртым типом висел «Форум» — серая
-- кнопка, по нажатию тост «Форумы скоро появятся». Последняя такая заглушка.
--
-- Форум — это канал, в котором нет общей ленты: вместо неё список обсуждений,
-- каждое со своим названием, тегами и своей перепиской. Ровно то, чем уже
-- являются ветки (70_threads.sql): строка в threads плюс сообщения в messages
-- с её thread_id. Поэтому новой таблицы «постов» здесь нет и не нужно —
-- обсуждение форума это ветка, и она бесплатно получает закреп, реакции,
-- правку и вложения, которые уже работают для веток.
--
-- Не хватало четырёх вещей, и все они добавляются ниже:
--   1) теги, чтобы список можно было отфильтровать;
--   2) время последней активности и число ответов — иначе «сначала свежие»
--      пришлось бы считать на клиенте, а это отдельный запрос на каждый пост;
--   3) закрепление и закрытие обсуждения;
--   4) права: кто может закрывать, закреплять и писать в закрытое.
--
-- Заодно чинятся два изъяна, которые были и у обычных веток, — см. ниже
-- «Права на ветку» и «Ветки приватного канала».

-- ── Поля обсуждения ────────────────────────────────────────────────────────
-- tags — идентификаторы тегов из настроек канала (channels.settings.forum_tags).
-- Теги живут в jsonb канала, а не отдельной таблицей: их десяток на канал,
-- редактирует их тот же человек и тем же сохранением, что и прочие настройки
-- канала, а список тегов поста — это просто набор их id.
alter table public.threads add column if not exists tags text[] not null default '{}';
alter table public.threads add column if not exists pinned boolean not null default false;
alter table public.threads add column if not exists locked boolean not null default false;
alter table public.threads add column if not exists reply_count int not null default 0;
alter table public.threads add column if not exists last_activity timestamptz not null default now();

-- Список форума почти всегда сортируется по последней активности внутри канала.
create index if not exists threads_channel_activity_idx
  on public.threads (channel_id, last_activity desc);

-- ── Счётчик ответов и время последней активности ───────────────────────────
-- Ведёт база, а не клиент. Две причины. Первая — считать на клиенте значит
-- слать по запросу на каждое обсуждение в списке. Вторая важнее: last_activity
-- задаёт порядок в списке, и если бы его писал клиент, любой мог бы держать
-- своё обсуждение первым, обновляя поле без единого сообщения.
create or replace function public.bump_thread_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Метка на время транзакции: ниже по файлу у threads стоит сторож на update,
  -- который возвращает счётчики к прежним значениям (чтобы их не подделывал
  -- клиент). Без этой метки он откатил бы и то, что пишем здесь, — счётчик
  -- ответов навсегда остался бы нулём, а список не сортировался бы вовсе.
  perform set_config('ponoi.thread_bump', '1', true);
  if tg_op = 'INSERT' then
    if new.thread_id is not null then
      update public.threads
         set reply_count = reply_count + 1,
             last_activity = greatest(last_activity, coalesce(new.created_at, now()))
       where id = new.thread_id;
    end if;
  elsif tg_op = 'DELETE' then
    if old.thread_id is not null then
      -- greatest(...,0): счётчик не должен уйти в минус, если строку удалили
      -- в обход триггера (например, восстановлением дампа).
      update public.threads
         set reply_count = greatest(reply_count - 1, 0)
       where id = old.thread_id;
    end if;
  end if;
  perform set_config('ponoi.thread_bump', '', true);
  return null;
end;
$$;

drop trigger if exists messages_thread_activity on public.messages;
create trigger messages_thread_activity
  after insert or delete on public.messages
  for each row execute function public.bump_thread_activity();

-- Существующие ветки: пересчитать по факту, а не оставить нули и now().
update public.threads t
   set reply_count = coalesce(m.cnt, 0),
       last_activity = coalesce(m.last_at, t.created_at)
  from (select thread_id, count(*) as cnt, max(created_at) as last_at
          from public.messages where thread_id is not null group by thread_id) m
 where m.thread_id = t.id;
update public.threads t
   set last_activity = t.created_at
 where not exists (select 1 from public.messages m where m.thread_id = t.id);

-- ── Кто распоряжается обсуждением ──────────────────────────────────────────
-- 32 = управление сообщениями, 4 = управление каналами (см. PERM в
-- src/lib/permissions.ts) — те же права, что решают судьбу канала только для
-- чтения в 78_channel_readonly.sql.
create or replace function public.thread_is_moderator(p_server uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.servers s
     where s.id = p_server
       and (s.owner = p_user
            or (public.server_permissions(s.id, p_user) & 32) <> 0
            or (public.server_permissions(s.id, p_user) & 4) <> 0)
  );
$$;

revoke all on function public.thread_is_moderator(uuid, uuid) from public;
grant execute on function public.thread_is_moderator(uuid, uuid) to authenticated;

-- Можно ли писать в обсуждение. Закрытое — только модераторам.
-- Проверка стоит в базе, а не в том, что клиент прячет поле ввода: сообщение
-- можно вставить и напрямую, мимо приложения.
create or replace function public.thread_can_post(p_thread uuid, p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case
    when not coalesce((select t.locked from public.threads t where t.id = p_thread), false) then true
    else public.thread_is_moderator((select t.server_id from public.threads t where t.id = p_thread), p_user)
  end;
$$;

revoke all on function public.thread_can_post(uuid, uuid) from public;
grant execute on function public.thread_can_post(uuid, uuid) to authenticated;

-- ── Права на ветку ─────────────────────────────────────────────────────────
-- Было: threads_update разрешал изменить ЛЮБУЮ ветку любому участнику сервера
-- (using (is_member(server_id)), без with check). То есть любой мог
-- переименовать или свернуть чужую ветку, а с появлением форумов — ещё и
-- закрыть чужое обсуждение и закрепить своё наверху списка. Это тот же изъян,
-- что чинили в 77 и 78: запрет держался только на том, что интерфейс не
-- показывал кнопку.
--
-- Стало: своё обсуждение ведёт автор, чужое — владелец сервера и модераторы.
drop policy if exists "threads_update" on public.threads;
create policy "threads_update" on public.threads for update to authenticated
  using (is_member(server_id) and (created_by = auth.uid() or public.thread_is_moderator(server_id, auth.uid())))
  with check (is_member(server_id) and (created_by = auth.uid() or public.thread_is_moderator(server_id, auth.uid())));

-- Что автор изменить не может даже у себя. with check выше проверяет строку
-- целиком и потому не отличает «переименовал» от «перенёс в другой сервер»,
-- поэтому неизменяемые поля возвращаются на место здесь.
create or replace function public.threads_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Обновление от триггера сообщений (bump_thread_activity) пропускаем как есть:
  -- это и есть единственный законный способ изменить счётчики.
  if coalesce(current_setting('ponoi.thread_bump', true), '') = '1' then
    return new;
  end if;
  -- Личность обсуждения не меняется никем: перенос в другой канал или сервер
  -- увёл бы с собой все сообщения, а подделка автора — авторство поста.
  new.id             := old.id;
  new.channel_id     := old.channel_id;
  new.server_id      := old.server_id;
  new.created_by     := old.created_by;
  new.created_by_name := old.created_by_name;
  new.created_at     := old.created_at;
  -- Счётчики ведёт триггер сообщений. Иначе автор поднимал бы своё обсуждение
  -- в начало списка, просто переписывая last_activity.
  new.reply_count    := old.reply_count;
  new.last_activity  := old.last_activity;
  -- Закрепить и закрыть может только модератор. Автору оставлены название,
  -- теги и «свернуть» — то, что относится к его собственному обсуждению.
  if not public.thread_is_moderator(old.server_id, auth.uid()) then
    new.pinned := old.pinned;
    new.locked := old.locked;
  end if;
  return new;
end;
$$;

drop trigger if exists threads_guard_update_trg on public.threads;
create trigger threads_guard_update_trg
  before update on public.threads
  for each row execute function public.threads_guard_update();

-- ── Ветки приватного канала ────────────────────────────────────────────────
-- Было: threads_read проверял только участие в сервере. Названия веток и
-- обсуждений приватного канала (69_channel_privacy.sql) при этом читал любой
-- участник — само сообщение он бы не увидел, а заголовок «зарплаты за июль»
-- увидел бы. Читаем ветки по тому же правилу, что и сам канал.
drop policy if exists "threads_read" on public.threads;
create policy "threads_read" on public.threads for select to authenticated
  using (is_member(server_id) and public.can_view_channel(channel_id, auth.uid()));

-- Создать обсуждение может тот, кто может писать в этот канал. Раньше в канале
-- только для чтения (78) нельзя было отправить сообщение, но можно было
-- завести ветку и писать в ней — запрет обходился в один шаг.
drop policy if exists "threads_insert" on public.threads;
create policy "threads_insert" on public.threads for insert to authenticated
  with check (
    is_member(server_id)
    and created_by = auth.uid()
    and public.can_view_channel(channel_id, auth.uid())
    and public.channel_can_send(channel_id, auth.uid())
  );

-- Удалять обсуждение — автору и модераторам. Политики delete на threads не было
-- вовсе, то есть удалить ветку не мог никто, включая владельца сервера.
drop policy if exists "threads_delete" on public.threads;
create policy "threads_delete" on public.threads for delete to authenticated
  using (is_member(server_id) and (created_by = auth.uid() or public.thread_is_moderator(server_id, auth.uid())));

-- ── Запрет писать в закрытое обсуждение ────────────────────────────────────
-- Тот же текст, что в 78_channel_readonly.sql, плюс последняя строка.
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert" on public.messages for insert with check (
  author = auth.uid() and exists (
    select 1 from public.channels c where c.id = messages.channel_id and is_member(c.server_id)
    and not exists (select 1 from public.server_members sm where sm.server_id = c.server_id and sm.user_id = auth.uid()
                     and sm.timeout_until is not null and sm.timeout_until > now())
    and (messages.attach_url is null or exists (
      select 1 from public.servers s where s.id = c.server_id and (s.owner = auth.uid() or (public.server_permissions(s.id, auth.uid()) & 8192) <> 0)
    ))
  )
  and public.can_view_channel(messages.channel_id, auth.uid())
  and public.channel_can_send(messages.channel_id, auth.uid())
  and (messages.thread_id is null or public.thread_can_post(messages.thread_id, auth.uid()))
);
