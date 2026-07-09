-- v1.161.0: раньше INSERT в server_events разрешался любому auth.uid() без проверки
-- членства в сервере или прав — кнопка «Создать событие» в UI была декоративной
-- защитой, обойти которую мог кто угодно прямым запросом. Теперь настоящее право:
-- владелец сервера или роль с битом MANAGE_CHANNELS (4), как «Управление каналами».
drop policy if exists "server_events insert" on server_events;
create policy "server_events insert" on server_events for insert with check (
  auth.uid() = created_by
  and (
    auth.uid() = (select owner from servers where id = server_id)
    or (server_permissions(server_id, auth.uid()) & 4) <> 0
  )
);
