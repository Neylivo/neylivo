import { useEffect, useState } from 'react'
import { Icon } from './icons'
import {
  canScan, scanNow, loadScan, sortGames, gameState, agoLabel, milestonePercent,
  type ScannedGame,
} from '../lib/gameProgress'

// v1.482.0: «Прохождения» — список игр с этого компьютера.
//
// Владелец попросил отслеживание прогресса, «как у WeMod»: приложение само
// находит игры, а не просит заводить их руками. Обход делает настольная часть
// (electron/gameScan.cjs), здесь — только показ.
//
// ЧЕСТНОСТЬ ЭТОГО ЭКРАНА. Мы показываем ровно то, что правда прочитали:
// сколько наиграно, когда последний раз запускали, сколько файлов сохранения и
// сколько вех пройдено. «Глава 4 из 12» тут не будет: формат сохранений у
// каждой игры свой, и такую цифру пришлось бы выдумать — а человек ей поверит.

const СОСТОЯНИЕ: Record<string, { цвет: string; текст: string }> = {
  'играю': { цвет: 'ok', текст: 'играю' },
  'отложил': { цвет: 'warn', текст: 'отложил' },
  'забросил': { цвет: 'mut', текст: 'забросил' },
  'не начинал': { цвет: 'mut', текст: 'не начинал' },
}

export function GameProgressList() {
  const [игры, setИгры] = useState<(ScannedGame & { gone?: boolean })[]>(() => loadScan())
  const [идёт, setИдёт] = useState(false)
  const [беда, setБеда] = useState<string | null>(null)
  const можно = canScan()

  async function обойти() {
    setИдёт(true)
    setБеда(null)
    try {
      const r = await scanNow()
      setИгры(r.games)
      if (r.error) setБеда(r.error)
    } catch (e: any) {
      setБеда(e?.message ?? String(e))
    } finally { setИдёт(false) }
  }

  // Первый раз — сами: человек открыл раздел, значит хочет увидеть список, а не
  // нажимать ещё одну кнопку. Дальше — только по кнопке: лазить по диску при
  // каждом открытии незачем.
  useEffect(() => {
    if (можно && игры.length === 0) void обойти()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const список = sortGames(игры) as (ScannedGame & { gone?: boolean })[]

  return (
    <>
      <div className="pqs-sec-t">Прохождения</div>
      <div className="pqs2-desc">
        NeyLivo сам смотрит, во что ты играешь: библиотеки Steam, время в игре, когда последний раз
        запускал, сохранения и пройденные вехи. Всё это остаётся <b>на этом компьютере</b> — наружу
        не уходит ни строчки, пока ты сам не поделишься игрой.
      </div>

      {!можно && (
        <div className="cset-hint">
          Работает только в приложении на компьютере: в браузере и на телефоне файлов игр не видно.
        </div>
      )}

      {можно && (
        <div className="gp-top">
          <button className="pqs2-btn" onClick={обновить} disabled={идёт}>
            <Icon name="rotate" size={14} /> {идёт ? 'Смотрю…' : 'Обновить'}
          </button>
          {список.length > 0 && <span className="mut">{список.length} игр</span>}
        </div>
      )}

      {беда && <div className="cset-hint">{беда}</div>}

      {список.length === 0 && !идёт && можно && (
        <div className="cset-hint">Игр не нашлось. NeyLivo смотрит библиотеки Steam и обычные папки сохранений.</div>
      )}

      <div className="gp-list">
        {список.map(g => {
          const с = состояние(g)
          const проц = milestonePercent(g.milestones)
          return (
            <div key={g.appId} className={'gp-row' + (g.gone ? ' gone' : '')}>
              <div className="gp-nm">
                <b className="notr" translate="no">{g.name}</b>
                <span className={'gp-tag ' + СОСТОЯНИЕ[с].цвет}>{СОСТОЯНИЕ[с].текст}</span>
                {g.gone && <span className="gp-tag mut">удалена с диска</span>}
              </div>
              <div className="gp-meta">
                <span>{g.hours}</span>
                <span className="gp-dot" />
                <span>{agoLabel(g.lastPlayed)}</span>
                {g.saves && <><span className="gp-dot" /><span>{g.saves.count} сохранений</span></>}
                {проц !== null && <><span className="gp-dot" /><span>вехи {g.milestones!.done}/{g.milestones!.total}</span></>}
              </div>
              {проц !== null && (
                <div className="gp-bar"><div className="gp-bar-in" style={{ width: проц + '%' }} /></div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )

  function обновить() { void обойти() }
  function состояние(g: ScannedGame) { return gameState(g) }
}
