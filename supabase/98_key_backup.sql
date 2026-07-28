-- v1.366.0: резервная копия ключа личных сообщений.
--
-- Зачем. Ключ шифрования принадлежал устройству и стирался при выходе — намеренно,
-- чтобы не достаться следующему вошедшему на этом компьютере. Но вместе с ним
-- терялась и вся переписка: после перезахода человек видел «Сообщение зашифровано
-- для другого устройства» вместо собственных сообщений. Для мессенджера, которым
-- пользуются на одном ноутбуке, это не безопасность, а поломка.
--
-- Что здесь лежит. Только ЗАШИФРОВАННЫЙ ключ. Шифруется он ключом, выведенным из
-- пароля человека (PBKDF2, 250 000 повторов, соль в этой же строке). Пароль сюда
-- не попадает никогда и на сервере не хранится — Supabase держит от него только
-- свой хэш, а наш ключ выводится из самого пароля в браузере.
--
-- Что это меняет по-честному. Раньше приватный ключ не существовал в переносимом
-- виде вовсе: его нечего было потребовать, украсть или выдать по запросу. Теперь
-- он существует — в виде, который бесполезен без пароля владельца. Тот, кто
-- получит и базу, и пароль, прочитает переписку. Это цена за то, чтобы человек
-- не терял свои сообщения при каждом перезаходе, и она выбрана осознанно.

create table if not exists key_backups (
  user_id    uuid primary key references auth.users on delete cascade,
  salt       text not null,          -- случайная соль для PBKDF2, не секрет
  wrapped    jsonb not null,         -- {iv, ct} — приватный ключ под AES-GCM
  device_id  text,                   -- какое устройство положило копию, для «откуда»
  updated_at timestamptz not null default now()
);

alter table key_backups enable row level security;

-- Только свой. Ни чтения, ни записи чужой строки — даже зашифрованной: по одному
-- лишь наличию копии видно, кем и когда пользовались приложением.
drop policy if exists "kb_read"   on key_backups;
drop policy if exists "kb_write"  on key_backups;
drop policy if exists "kb_update" on key_backups;
drop policy if exists "kb_delete" on key_backups;

create policy "kb_read"   on key_backups for select to authenticated using (user_id = auth.uid());
create policy "kb_write"  on key_backups for insert to authenticated with check (user_id = auth.uid());
create policy "kb_update" on key_backups for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "kb_delete" on key_backups for delete to authenticated using (user_id = auth.uid());

-- Размер ограничиваем: строка «зашифрованный ключ» имеет понятный размер, и место
-- под произвольные данные тут не нужно.
alter table key_backups drop constraint if exists key_backups_sane;
alter table key_backups add constraint key_backups_sane check (
  length(salt) between 16 and 128
  and length(wrapped::text) < 4096
);
