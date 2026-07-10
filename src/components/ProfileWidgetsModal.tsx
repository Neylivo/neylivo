import { useEffect, useState } from 'react'
import { Icon } from './icons'
import { resolveCover } from '../lib/gameCovers'
import { fetchGameCatalog, type CatalogGame } from '../lib/activity'
import { gameIconOf } from '../lib/gameIcon'
import type { ProfilePrefs } from '../lib/profilePrefs'
import type { WidgetField } from './ProfileCard'

const RECO_DISMISS_KEY = 'ponoi_widget_reco_dismissed'

// v1.169.0: «Ваши виджеты» — экран управления виджетами доски профиля, как в
// Discord (Настройки → Профиль → Виджеты): по секции на тип виджета, добавление
// через тот же GamePickerModal (передаётся наружу через onAdd), удаление — крестиком
// на чипе. «Рекомендовано для вас» — под «Текущими играми», как в примере.
function WidgetSection({ title, sub, games, covers, cap, onAdd, onRemove }:
  { title: string; sub?: string; games: string[]; covers: Record<string, string | null>; cap: number
    onAdd: () => void; onRemove: (g: string) => void }) {
  return (
    <div className="pwm-sect">
      <div className="pwm-sect-h">
        <span>{title}</span>
        {games.length < cap && <button className="pwm-sect-add" title="Добавить игру" onClick={onAdd}><Icon name="plus" size={14} /></button>}
      </div>
      {games.length === 0 && sub && <div className="pwm-sect-sub">{sub}</div>}
      {games.length > 0 && <div className="pwm-chips">
        {games.map(g => (
          <div key={g} className="pwm-chip">
            {covers[g] ? <img src={covers[g]!} alt="" /> : <span className="pwm-chip-ph"><Icon name={gameIconOf(g)} size={16} /></span>}
            <span className="pwm-chip-nm">{g}</span>
            <button className="pwm-chip-x" title="Убрать из виджета" onClick={() => onRemove(g)}><Icon name="close" size={12} /></button>
          </div>
        ))}
      </div>}
    </div>
  )
}

export function ProfileWidgetsModal({ pp, covers, onAdd, onAddDirect, onRemove, onClose }: {
  pp: ProfilePrefs
  covers: Record<string, string | null>
  onAdd: (field: WidgetField, mode: 'single' | 'multi') => void
  onAddDirect: (field: WidgetField, game: string) => void
  onRemove: (field: WidgetField, g: string) => void
  onClose: () => void
}) {
  const [reco, setReco] = useState<CatalogGame[]>([])
  const [recoCovers, setRecoCovers] = useState<Record<string, string | null>>({})
  const [recoDismissed, setRecoDismissed] = useState(() => localStorage.getItem(RECO_DISMISS_KEY) === '1')

  useEffect(() => {
    if (recoDismissed) return
    let ok = true
    fetchGameCatalog(undefined, 6).then(gs => {
      if (!ok) return
      setReco(gs)
      for (const g of gs) resolveCover(g.name).then(u => { if (ok) setRecoCovers(c => ({ ...c, [g.name]: u })) })
    })
    return () => { ok = false }
  }, [recoDismissed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function dismissReco() { setRecoDismissed(true); localStorage.setItem(RECO_DISMISS_KEY, '1') }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pwm" onClick={e => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose}><Icon name="close" size={18} /></button>
        <div className="pwm-h">Ваши виджеты</div>

        <WidgetSection title="Любимая игра" sub="Игра, которую вы отметите как основную, появится на доске профиля."
          games={pp.favGames[0] ? [pp.favGames[0]] : []} covers={covers} cap={1}
          onAdd={() => onAdd('favGames', 'single')} onRemove={() => onRemove('favGames', pp.favGames[0])} />

        <WidgetSection title="Мои любимые игры" sub="Добавьте до 5 игр, которые вам особенно нравятся."
          games={pp.favGames.slice(1)} covers={covers} cap={5}
          onAdd={() => onAdd('favGames', 'multi')} onRemove={g => onRemove('favGames', g)} />

        <WidgetSection title="Текущие игры" sub="Добавьте до 5 игр. Этот виджет отобразится в профиле, когда вы добавите хотя бы одну игру."
          games={pp.playGames} covers={covers} cap={5}
          onAdd={() => onAdd('playGames', 'multi')} onRemove={g => onRemove('playGames', g)} />

        {!recoDismissed && <div className="pwm-reco">
          <div className="pwm-reco-h"><span>Рекомендованы для вас</span>
            <button className="pwm-reco-x" title="Скрыть" onClick={dismissReco}><Icon name="close" size={13} /></button>
          </div>
          <div className="pwm-reco-row">
            {reco.filter(g => !pp.playGames.includes(g.name)).slice(0, 6).map(g => (
              <div key={g.name} className="pwm-reco-item" title={'Добавить «' + g.name + '» в «Текущие игры»'} onClick={() => onAddDirect('playGames', g.name)}>
                {recoCovers[g.name] ? <img src={recoCovers[g.name]!} alt="" /> : <span className="pwm-reco-ph"><Icon name={gameIconOf(g.name)} size={18} /></span>}
              </div>
            ))}
          </div>
        </div>}

        <WidgetSection title="Хочу поиграть" sub="Добавьте до 5 игр, в которые хотите сыграть — другие увидят это на вашей доске."
          games={pp.wishGames} covers={covers} cap={5}
          onAdd={() => onAdd('wishGames', 'multi')} onRemove={g => onRemove('wishGames', g)} />
      </div>
    </div>
  )
}
