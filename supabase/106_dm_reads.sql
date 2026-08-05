-- v1.477.0: отметка «просмотрено» в личных сообщениях.
--
-- Зачем. В приложении не было никакого следа о том, прочитал ли собеседник
-- сообщение: счётчики непрочитанного считаются на устройстве и наружу не
-- выходят. То есть «доставлено» и «прочитано» отличить было нельзя вообще
-- ничем, и человек не знал, молчат ему в ответ или просто не видели.
--
-- Как устроено. Одна строка на «человек × разговор»: докуда он дочитал. Не
-- отметка на каждое сообщение — это было бы в сотни раз больше записей ради
-- того же самого: время последнего прочитанного и есть ответ на вопрос
-- «просмотрено ли моё сообщение» (сравниваем с временем сообщения).
--
-- ПРИВАТНОСТЬ. Отметка видна ТОЛЬКО второму участнику этого же разговора —
-- правила ниже не дают прочитать её никому больше. Кто не хочет её показывать,
-- выключает в настройках приложения; тогда клиент просто не пишет строку, и
-- собеседник видит «доставлено», как раньше.

create table if not exists dm_reads (
  thread_id  uuid not null references dm_threads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists dm_reads_thread_idx on dm_reads(thread_id);

alter table dm_reads enable row level security;

-- Повторный прогон безопасен: сначала снимаем, потом ставим. Так же сделаны
-- прежние миграции — владелец применяет их не по одному разу.
drop policy if exists "dmr_read"   on dm_reads;
drop policy if exists "dmr_upsert" on dm_reads;
drop policy if exists "dmr_update" on dm_reads;
drop policy if exists "dmr_delete" on dm_reads;

-- Читать — только участникам этого разговора. Свою и собеседника, больше ничью.
create policy "dmr_read" on dm_reads for select using (
  exists (select 1 from dm_threads t where t.id = dm_reads.thread_id
          and (t.user_a = auth.uid() or t.user_b = auth.uid()))
);

-- Писать — только за СЕБЯ и только в своём разговоре. Иначе можно было бы
-- поставить чужую отметку «прочитано» и соврать за другого человека.
create policy "dmr_upsert" on dm_reads for insert with check (
  user_id = auth.uid() and exists (
    select 1 from dm_threads t where t.id = dm_reads.thread_id
    and (t.user_a = auth.uid() or t.user_b = auth.uid()))
);

create policy "dmr_update" on dm_reads for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Убрать свою отметку можно: это способ передумать и перестать показывать.
create policy "dmr_delete" on dm_reads for delete using (user_id = auth.uid());

-- Живое обновление: собеседник должен увидеть «просмотрено» сразу, а не после
-- перезагрузки.
do $$
begin
  alter publication supabase_realtime add table dm_reads;
exception when duplicate_object then null;
end $$;
