-- 75: публичные ключи устройств для сквозного шифрования (v1.292.0).
--
-- Хранится ТОЛЬКО публичная часть — она не секрет, её и надо раздавать. Приватный
-- ключ никогда не покидает устройство: он создаётся неизвлекаемым (extractable:
-- false) и живёт в IndexedDB как объект CryptoKey, который невозможно прочитать
-- даже коду самого приложения (см. src/lib/crypto/core.ts).
--
-- Ключ на УСТРОЙСТВО, а не на человека: у телефона и компьютера они разные.
-- Отправитель шифрует сообщение для каждого устройства получателя отдельно. Это
-- значит, что новое устройство не сможет прочитать переписку, которая была до его
-- появления — так же, как в Signal при подключении нового устройства. Плата за то,
-- что приватный ключ нигде не хранится в переносимом виде и его нечего украсть.

create table if not exists public.user_keys (
  user_id    uuid not null references auth.users on delete cascade,
  device_id  text not null,
  public_key jsonb not null,
  -- Показывается человеку для сверки «цифры совпали?» голосом или при встрече.
  -- Защищает от подмены ключа сервером: сервер может подсунуть свой ключ, и
  -- единственный способ это заметить — сверить отпечаток по другому каналу.
  fingerprint text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

alter table public.user_keys enable row level security;

-- Читать может любой вошедший: публичные ключи для того и существуют, чтобы их
-- мог взять тот, кто собирается тебе написать.
drop policy if exists "user_keys_read" on public.user_keys;
create policy "user_keys_read" on public.user_keys
  for select using (auth.role() = 'authenticated');

-- Писать — только свои и только за себя. Иначе кто угодно подменил бы чужой
-- публичный ключ своим и стал читать чужую переписку.
drop policy if exists "user_keys_insert" on public.user_keys;
create policy "user_keys_insert" on public.user_keys
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_keys_update" on public.user_keys;
create policy "user_keys_update" on public.user_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_keys_delete" on public.user_keys;
create policy "user_keys_delete" on public.user_keys
  for delete using (auth.uid() = user_id);

-- Живое обновление: устройство должно узнавать о появлении нового ключа у
-- собеседника сразу, иначе первое сообщение на новый телефон уйдёт мимо него.
alter publication supabase_realtime add table public.user_keys;
