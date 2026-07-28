-- v1.377.0: сколько раз трек слушали — всего и лично тобой.
--
-- Зачем два счётчика, а не один. Общий отвечает на вопрос «что тут вообще
-- слушают» и виден всем на карточке. Личный нужен для очереди: она должна быть
-- не случайным набором, а тем, что слушает именно ты. Смешать их нельзя —
-- по общему числу нельзя понять, твоё это или чужое.
--
-- Личные числа чужому не видны: по ним видно, что человек слушает, а это ровно
-- то, о чём его не спрашивали.

-- ── Личное: сколько раз я слушал этот трек ────────────────────────────────
create table if not exists music_plays (
  user_id   uuid not null references auth.users on delete cascade,
  track_id  uuid not null references music_tracks on delete cascade,
  plays     int not null default 0,
  last_at   timestamptz not null default now(),
  primary key (user_id, track_id)
);
alter table music_plays enable row level security;

drop policy if exists "mp_read" on music_plays;
drop policy if exists "mp_write" on music_plays;
create policy "mp_read"  on music_plays for select to authenticated using (user_id = auth.uid());
create policy "mp_write" on music_plays for all    to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Общее: сколько раз трек слушали все ───────────────────────────────────
alter table music_tracks add column if not exists plays int not null default 0;

-- Обновлять его напрямую нельзя: иначе любой перепишет чужие числа как захочет.
-- Всё идёт через функцию ниже, а она прибавляет ровно единицу.
--
-- Накрутить своё же число повторным прослушиванием человек, конечно, может —
-- это не выборы, а подсказка «что тут слушают». Защищаемся от подделки чужих
-- чисел и от произвольной записи, а не от того, что кто-то заслушает трек.
create or replace function public.record_play(p_track uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from music_tracks where id = p_track) then return; end if;

  insert into music_plays (user_id, track_id, plays, last_at)
    values (auth.uid(), p_track, 1, now())
  on conflict (user_id, track_id)
    do update set plays = music_plays.plays + 1, last_at = now();

  -- Флаг на время этой операции: только под ним триггер ниже пропустит новое
  -- значение счётчика. Обычный update его не ставит и счётчик не меняет.
  perform set_config('ponoi.counting_play', '1', true);
  update music_tracks set plays = plays + 1 where id = p_track;
  perform set_config('ponoi.counting_play', '', true);
end;
$$;

-- Без этого общее число переписывалось обычным запросом: правило доступа умеет
-- разрешать или запрещать строку целиком, но не отдельную колонку, а править
-- свои треки человеку надо (название, обложка). Стережём именно счётчик.
create or replace function public.music_plays_guard()
returns trigger language plpgsql as $$
begin
  if new.plays is distinct from old.plays
     and coalesce(current_setting('ponoi.counting_play', true), '') <> '1' then
    new.plays := old.plays;
  end if;
  return new;
end;
$$;

drop trigger if exists music_tracks_plays_guard on public.music_tracks;
create trigger music_tracks_plays_guard
  before update on public.music_tracks
  for each row execute function public.music_plays_guard();

revoke all on function public.record_play(uuid) from public;
grant execute on function public.record_play(uuid) to authenticated;
