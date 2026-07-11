-- v1.220.0: статистику игр (CS2 из game_matches, Dota 2 через привязанный SteamID)
-- раньше видел только сам игрок. Добавляем настройку приватности (все / только
-- друзья / никто, по умолчанию «все» — как обычную активность в профиле) и
-- переносим SteamID64 из приватного user_prefs в публичный profiles, иначе
-- Dota-статистику никто другой всё равно не смог бы посчитать.

alter table public.profiles add column if not exists steam_id text;
alter table public.profiles add column if not exists game_stats_visibility text not null default 'all';
alter table public.profiles drop constraint if exists profiles_game_stats_visibility_check;
alter table public.profiles add constraint profiles_game_stats_visibility_check
  check (game_stats_visibility in ('all', 'friends', 'none'));

-- Разовый перенос уже привязанных SteamID из user_prefs.account (jsonb) в новую
-- публичную колонку — иначе после миграции все потеряли бы привязку.
update public.profiles p set steam_id = up.account ->> 'steamId'
from public.user_prefs up
where up.user_id = p.id
  and coalesce(up.account ->> 'steamId', '') <> ''
  and p.steam_id is null;

-- Матчи видит сам игрок всегда; остальные — если игрок открыл статистику всем,
-- либо (при «только друзья») состоит с ним в принятой заявке в друзья.
drop policy if exists "game_matches select own" on public.game_matches;
drop policy if exists "game_matches select visible" on public.game_matches;
create policy "game_matches select visible" on public.game_matches
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = game_matches.user_id
        and (
          p.game_stats_visibility = 'all'
          or (
            p.game_stats_visibility = 'friends'
            and exists (
              select 1 from public.friend_requests fr
              where fr.status = 'accepted'
                and ((fr.from_user = auth.uid() and fr.to_user = game_matches.user_id)
                  or (fr.to_user = auth.uid() and fr.from_user = game_matches.user_id))
            )
          )
        )
    )
  );
