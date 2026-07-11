import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { fetchMatches, computeStats, type GameMatch } from '../lib/gameMatches'
import { fetchDotaStats, type DotaStats } from '../lib/opendota'

const RESULT_LABEL: Record<string, string> = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' }

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  return m + ' мин'
}

// v1.165.0: Dota 2 не идёт через локальный game_matches (GSI Valve не отдаёт MMR) —
// статистика тянется напрямую из OpenDota по привязанному SteamID64 (Настройки -> Активность).
// v1.220.0: steamId теперь публичный (profiles.steam_id, см. profilePrefs.ts) и передаётся
// снаружи — так же можно посмотреть чужую статистику, не только свою.
function DotaStatsBody({ steamId, isMe }: { steamId: string | null; isMe: boolean }) {
  const [stats, setStats] = useState<DotaStats | null | undefined>(undefined)

  useEffect(() => {
    if (!steamId) return
    let ok = true
    fetchDotaStats(steamId).then(s => { if (ok) setStats(s) })
    return () => { ok = false }
  }, [steamId])

  if (!steamId) return <div className="gstat-empty">{isMe
    ? 'Привяжи SteamID64 в Настройках → Активность, чтобы видеть статистику Dota 2 (медаль, MMR, последние матчи).'
    : 'Игрок не привязал SteamID64 — статистика Dota 2 недоступна.'}</div>
  if (stats === undefined) return <div className="gstat-empty">Загрузка…</div>
  if (stats === null) return <div className="gstat-empty">Не удалось получить данные OpenDota — профиль Dota может быть скрыт настройками приватности, либо SteamID указан неверно.</div>
  return (
    <>
      <div className="gstat-summary">
        <div className="gstat-num"><b>{stats.rank ?? '—'}</b><span>медаль</span></div>
        <div className="gstat-num"><b>{stats.mmrEstimate ?? '—'}</b><span>MMR (оценка)</span></div>
      </div>
      <div className="gstat-sect">Последние матчи</div>
      {stats.matches.length === 0
        ? <div className="gstat-empty">Матчей не найдено — либо их не было, либо профиль скрыт настройками приватности Dota.</div>
        : <div className="gstat-matches">
            {stats.matches.map(m => (
              <div key={m.match_id} className={'gstat-match dota' + (m.win ? ' win' : ' loss')}>
                <span className="gstat-match-res">{m.win ? 'Победа' : 'Поражение'}</span>
                <span className="gstat-match-map">{m.hero}</span>
                <span className="gstat-match-kda">{m.kills}/{m.deaths}/{m.assists}</span>
                <span className="gstat-match-score">{fmtDuration(m.duration)}</span>
                <span className="gstat-match-date">{new Date(m.start_time).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
              </div>
            ))}
          </div>}
    </>
  )
}

function Cs2StatsBody({ userId, gameName, isMe }: { userId: string; gameName: string; isMe: boolean }) {
  const [matches, setMatches] = useState<GameMatch[] | null>(null)

  useEffect(() => {
    let ok = true
    fetchMatches(userId, gameName, 30).then(m => { if (ok) setMatches(m) })
    return () => { ok = false }
  }, [userId, gameName])

  const stats = matches ? computeStats(matches) : null

  if (matches === null) return <div className="gstat-empty">Загрузка…</div>
  // v1.220.0: пустой список — это либо правда «матчей не было», либо статистика
  // скрыта настройками приватности игрока (RLS отдаёт пустой массив в обоих
  // случаях, честно различить нечем — тот же компромисс уже был у Dota-статистики).
  if (matches.length === 0) return <div className="gstat-empty">{isMe
    ? 'За последние 30 дней матчей не найдено — сыграй партию, и она появится здесь.'
    : 'За последние 30 дней матчей не найдено — либо их не было, либо статистика скрыта настройками приватности.'}</div>
  return (
    <>
      <div className="gstat-summary">
        <div className="gstat-num"><b>{stats!.total}</b><span>матчей</span></div>
        <div className="gstat-num"><b>{stats!.winrate}%</b><span>винрейт</span></div>
        <div className="gstat-num win"><b>{stats!.wins}</b><span>побед</span></div>
        <div className="gstat-num loss"><b>{stats!.losses}</b><span>поражений</span></div>
      </div>
      {stats!.hasKda && <div className="gstat-summary gstat-summary-5">
        <div className="gstat-num"><b>{stats!.kd.toFixed(2)}</b><span>K/D</span></div>
        <div className="gstat-num"><b>{stats!.avgKills.toFixed(1)}</b><span>убийств/матч</span></div>
        <div className="gstat-num"><b>{stats!.avgDeaths.toFixed(1)}</b><span>смертей/матч</span></div>
        <div className="gstat-num"><b>{stats!.avgAssists.toFixed(1)}</b><span>помощи/матч</span></div>
        <div className="gstat-num"><b>{stats!.totalMvps}</b><span>MVP</span></div>
      </div>}
      <div className="gstat-sect">Карты</div>
      <div className="gstat-list">
        {stats!.byMap.map(m => (
          <div key={m.map} className="gstat-row">
            <span className="gstat-row-nm">{m.map}</span>
            <span className="gstat-row-v">{m.count} · {m.count ? Math.round(m.wins / m.count * 100) : 0}% побед</span>
          </div>
        ))}
      </div>
      <div className="gstat-sect">Режимы</div>
      <div className="gstat-list">
        {stats!.byMode.map(m => (
          <div key={m.mode} className="gstat-row">
            <span className="gstat-row-nm">{m.mode}</span>
            <span className="gstat-row-v">{m.count}</span>
          </div>
        ))}
      </div>
      <div className="gstat-sect">Последние матчи</div>
      <div className="gstat-matches">
        {matches.slice(0, 20).map(m => (
          <div key={m.id} className={'gstat-match' + (m.result ? ' ' + m.result : '') + (stats!.hasKda ? ' has-kda' : '')}>
            <span className="gstat-match-res">{m.result ? RESULT_LABEL[m.result] : '—'}</span>
            <span className="gstat-match-map">{m.map || '—'}</span>
            <span className="gstat-match-mode">{m.mode || '—'}</span>
            <span className="gstat-match-score">{m.score || '—'}</span>
            {stats!.hasKda && <span className="gstat-match-kda">{m.kills != null ? `${m.kills}/${m.deaths}/${m.assists ?? 0}` : '—'}</span>}
            <span className="gstat-match-date">{new Date(m.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// Статистика за 30 дней по конкретной игре (v1.150.0) — открывается кликом по
// текущей активности в профиле, когда игра поддерживает статистику (CS2 — GSI,
// Dota 2 — OpenDota по привязанному SteamID, см. MATCH_TRACKED_GAMES).
export function GameStatsModal({ userId, gameName, steamId, isMe, onClose }:
  { userId: string; gameName: string; steamId: string | null; isMe: boolean; onClose: () => void }) {
  return (
    <div className="gstat-backdrop" onClick={onClose}>
      <div className="gstat-card" onClick={e => e.stopPropagation()}>
        <button className="gstat-x" onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="gstat-hdr"><Icon name="gamepad" size={18} /> {gameName} — статистика{gameName === 'Dota 2' ? '' : ' за 30 дней'}</div>
        {gameName === 'Dota 2' ? <DotaStatsBody steamId={steamId} isMe={isMe} /> : <Cs2StatsBody userId={userId} gameName={gameName} isMe={isMe} />}
      </div>
    </div>
  )
}
