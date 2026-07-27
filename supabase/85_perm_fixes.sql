-- 85: права, которые проверялись не тем битом или не проверялись вовсе (v1.326.0).
-- Найдено сплошной сверкой: для каждого права из src/lib/permissions.ts проверено,
-- встречается ли его бит в SQL вообще.

-- ── A0) ГЛАВНОЕ: «Управление вебхуками» было выдано ВСЕМ по умолчанию ──────
-- В 49_role_perms2.sql базовые права @everyone заданы числом 15872, а рядом
-- написано, из чего оно складывается:
--     MENTION_EVERYONE(2048)|ADD_REACTIONS(4096)|ATTACH_FILES(8192)|CREATE_INVITE(1024)
-- Но эта сумма равна 15360, а не 15872. Разница ровно 512 — MANAGE_WEBHOOKS.
-- То есть в число закралась лишняя единица, и право «Управление вебхуками»
-- получал КАЖДЫЙ участник КАЖДОГО сервера, ничего для этого не делая.
--
-- Пока вебхуков в приложении не было, это ничего не значило. С v1.319.0 значит
-- прямо: вебхук шлёт сообщения в канал под ЛЮБЫМ именем и с любой аватаркой,
-- то есть любой участник мог выдать себя за владельца сервера или за соседа.
-- Плюс список вебхуков канала (wh_read) тоже открывался всем.
--
-- Снимаем бит и у новых серверов (значение по умолчанию), и у всех уже
-- существующих. Остальные права не трогаем: если владелец что-то менял
-- осознанно через «Права по умолчанию — @everyone» (v1.321.0), это сохранится.
alter table public.servers alter column base_permissions set default 15360;
update public.servers set base_permissions = base_permissions & ~512
 where (base_permissions & 512) <> 0;

-- ── A) Вебхуки: проверялся НЕ ТОТ бит ──────────────────────────────────────
-- В 80_webhooks.sql стоит `& 16384` — это TIMEOUT_MEMBERS («отправлять в
-- тайм-аут»), а не MANAGE_WEBHOOKS (512). Последствий два, и оба неприятные:
--
--   1) модератор, которому выдали ТОЛЬКО тайм-аут, мог завести вебхук и слать
--      от его имени сообщения в любой канал сервера — а вебхук пишет под
--      произвольным именем, то есть выдаёт себя за кого угодно;
--   2) тот, кому выдали настоящее «Управление вебхуками», сделать этого НЕ мог:
--      интерфейс право показывал, база отказывала.
--
-- Ошибка моя, из v1.319.0. Здесь бит заменён на правильный.
drop policy if exists "wh_read" on public.webhooks;
create policy "wh_read" on public.webhooks for select to authenticated using (
  exists (
    select 1 from public.servers s where s.id = webhooks.server_id and (
      s.owner = auth.uid()
      or (public.server_permissions(s.id, auth.uid()) & 4) <> 0     -- MANAGE_CHANNELS
      or (public.server_permissions(s.id, auth.uid()) & 512) <> 0   -- MANAGE_WEBHOOKS
    )
  )
);

drop policy if exists "wh_insert" on public.webhooks;
create policy "wh_insert" on public.webhooks for insert to authenticated with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.channels c
    join public.servers s on s.id = c.server_id
    where c.id = webhooks.channel_id and c.server_id = webhooks.server_id and (
      s.owner = auth.uid()
      or (public.server_permissions(s.id, auth.uid()) & 4) <> 0
      or (public.server_permissions(s.id, auth.uid()) & 512) <> 0
    )
  )
);

drop policy if exists "wh_delete" on public.webhooks;
create policy "wh_delete" on public.webhooks for delete to authenticated using (
  exists (
    select 1 from public.servers s where s.id = webhooks.server_id and (
      s.owner = auth.uid()
      or (public.server_permissions(s.id, auth.uid()) & 4) <> 0
      or (public.server_permissions(s.id, auth.uid()) & 512) <> 0
    )
  )
);

-- ── B) Эмодзи и стикеры сервера: удалить мог любой участник ────────────────
-- Было `using (is_member(server_id))` на удаление, и в самой миграции 61 честно
-- написано, что право «Управление эмодзи» проверяется только на клиенте. То есть
-- любой участник мог зайти мимо интерфейса и снести сервером все эмодзи и стикеры,
-- включая чужие. Право в интерфейсе при этом показывалось как настоящее.
--
-- Теперь как в Discord: заводит и убирает тот, кому выдано управление эмодзи
-- (128), управление сервером (1) или владелец. Своё добавленное автор может
-- убрать и без права — он его и принёс.
create or replace function public.can_manage_emoji(p_server uuid, p_user uuid)
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
            or (public.server_permissions(s.id, p_user) & 1) <> 0
            or (public.server_permissions(s.id, p_user) & 128) <> 0)
  );
$$;

revoke all on function public.can_manage_emoji(uuid, uuid) from public;
grant execute on function public.can_manage_emoji(uuid, uuid) to authenticated;

drop policy if exists "server_emoji_insert" on public.server_emoji;
create policy "server_emoji_insert" on public.server_emoji for insert to authenticated
  with check (is_member(server_id) and created_by = auth.uid()
              and public.can_manage_emoji(server_id, auth.uid()));

drop policy if exists "server_emoji_delete" on public.server_emoji;
create policy "server_emoji_delete" on public.server_emoji for delete to authenticated
  using (is_member(server_id)
         and (created_by = auth.uid() or public.can_manage_emoji(server_id, auth.uid())));

drop policy if exists "stickers_insert" on public.stickers;
create policy "stickers_insert" on public.stickers for insert to authenticated
  with check (is_member(server_id) and created_by = auth.uid()
              and public.can_manage_emoji(server_id, auth.uid()));

drop policy if exists "stickers_delete" on public.stickers;
create policy "stickers_delete" on public.stickers for delete to authenticated
  using (is_member(server_id)
         and (created_by = auth.uid() or public.can_manage_emoji(server_id, auth.uid())));
