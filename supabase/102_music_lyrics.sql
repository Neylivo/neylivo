-- Ponoi — миграция 102: текст песни (v1.394.0).
--
-- Текст общий на всю Трекотеку, как автор и обложка (миграция 22): нашёл или
-- набрал один — видят все. Держать его у каждого на устройстве значило бы, что
-- один и тот же текст десять человек ищут по десять раз.
--
-- Выполни в Supabase Dashboard -> SQL Editor.
--
-- Пока миграция не применена, приложение хранит текст на устройстве человека и
-- прямо пишет об этом при сохранении — работать оно не перестаёт.

create table if not exists music_lyrics (
  track_id   uuid primary key references music_tracks on delete cascade,
  text       text not null default '',
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);

alter table music_lyrics enable row level security;

-- Читают все, кто вошёл: Трекотека общая, и текст к ней тоже.
drop policy if exists "ml_read" on music_lyrics;
create policy "ml_read" on music_lyrics for select to authenticated using (true);

-- Добавить текст может любой вошедший: чаще всего его добавляет тот, кто
-- слушает, а не тот, кто когда-то принёс трек.
drop policy if exists "ml_insert" on music_lyrics;
create policy "ml_insert" on music_lyrics for insert to authenticated
  with check (updated_by = auth.uid());

-- А вот переписывать уже добавленный текст может только тот, кто его добавил,
-- или владелец трека. Иначе любой прохожий заменит чужую работу на что угодно —
-- ровно то же правило, что у найденной обложки (миграция 22).
drop policy if exists "ml_update" on music_lyrics;
create policy "ml_update" on music_lyrics for update to authenticated
  using (
    updated_by = auth.uid()
    or exists (select 1 from music_tracks t where t.id = track_id and t.owner = auth.uid())
  )
  with check (updated_by = auth.uid());

-- Удаление отдельной строки не нужно: пустой текст — это пустая строка в поле,
-- и она сохраняется тем же правилом. Строка уходит вместе с треком (cascade).
drop policy if exists "ml_delete" on music_lyrics;
create policy "ml_delete" on music_lyrics for delete to authenticated
  using (
    updated_by = auth.uid()
    or exists (select 1 from music_tracks t where t.id = track_id and t.owner = auth.uid())
  );

-- Время правки ставит база, а не клиент: клиент может прислать что угодно.
create or replace function music_lyrics_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists music_lyrics_touch on music_lyrics;
create trigger music_lyrics_touch before insert or update on music_lyrics
  for each row execute function music_lyrics_touch();
