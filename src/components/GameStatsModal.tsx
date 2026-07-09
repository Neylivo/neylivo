import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { fetchMatches, computeStats, type GameMatch } from '../lib/gameMatches'

const RESULT_LABEL: Record<string, string> = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' }

// Статистика за 30 дней по конкретной игре (v1.150.0) — открывается кликом по
// текущей активности в профиле, когда игра поддерживает GSI (сейчас — CS2).
export function GameStatsModal({ userId, gameName, onClose }: { userId: string; gameName: string; onClose: () => void }) {
  const [matches, setMatches] = useState<GameMatch[] | null>(null)

  useEffect(() => {
    let ok = true
    fetchMatches(userId, gameName, 30).then(m => { if (ok) setMatches(m) })
    return () => { ok = false }
  }, [userId, gameName])

  const stats = matches ? computeStats(matches) : null

  return (
    <div className="gstat-backdrop" onClick={onClose}>
      <div className="gstat-card" onClick={e => e.stopPropagation()}>
        <button className="gstat-x" onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="gstat-hdr"><Icon name="gamepad" size={18} /> {gameName} — статистика за 30 дней</div>
        {matches === null
          ? <div className="gstat-empty">Загрузка…</div>
          : matches.length === 0
          ? <div className="gstat-empty">За последние 30 дней матчей не найдено — сыграй партию, и она появится здесь.</div>
          : <>
              <div className="gstat-summary">
                <div className="gstat-num"><b>{stats!.total}</b><span>матчей</span></div>
                <div className="gstat-num"><b>{stats!.winrate}%</b><span>винрейт</span></div>
                <div className="gstat-num win"><b>{stats!.wins}</b><span>побед</span></div>
                <div className="gstat-num loss"><b>{stats!.losses}</b><span>поражений</span></div>
              </div>
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
                  <div key={m.id} className={'gstat-match' + (m.result ? ' ' + m.result : '')}>
                    <span className="gstat-match-res">{m.result ? RESULT_LABEL[m.result] : '—'}</span>
                    <span className="gstat-match-map">{m.map || '—'}</span>
                    <span className="gstat-match-mode">{m.mode || '—'}</span>
                    <span className="gstat-match-score">{m.score || '—'}</span>
                    <span className="gstat-match-date">{new Date(m.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
                  </div>
                ))}
              </div>
            </>}
      </div>
    </div>
  )
}
