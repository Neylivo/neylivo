import { useEffect, useState } from 'react'
import type { Activity, Game, Listening } from '../lib/presence'
import { livePos, leftOver, listenPct, fmtClock } from '../lib/listenProgress'
import { Icon } from './icons'
import { gameIconOf } from '../lib/gameIcon'
import { toastOk } from '../lib/toast'

// «2 ч 34 мин 1 сек» — сколько длится активность.
export function fmtElapsed(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  if (h > 0) return h + ' ч ' + m + ' мин ' + ss + ' сек'
  if (m > 0) return m + ' мин ' + ss + ' сек'
  return ss + ' сек'
}

// Живая строка активности: «Играю в Doom — 2 ч 34 мин 1 сек», тикает каждую секунду.
export function ActivityLabel({ activity }: { activity: Activity }) {
  const [, setTick] = useState(0)
  const timed = activity.since > 0
  useEffect(() => {
    if (!timed) return
    const t = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [timed])
  // v1.332.0: своя активность приходит с since = 0 — у неё нет начала, которое
  // имело бы смысл показывать. «Пью чай — 4 ч 12 мин 6 сек» выглядело бы шуткой.
  if (!timed) return <>{activity.text}</>
  return <>{activity.text} — {fmtElapsed(activity.since)}</>
}


// «12:34» / «1:07:09» — живой таймер игры, тикает каждую секунду (v1.28.0).
export function ClockElapsed({ since }: { since: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60
  if (h > 0) return <>{h}:{String(m).padStart(2, '0')}:{String(ss).padStart(2, '0')}</>
  return <>{m}:{String(ss).padStart(2, '0')}</>
}

// «Играет в …» с мини-обложкой — строка под ником (участники сервера, сайдбар ЛС).
export function GameLine({ game }: { game: Game }) {
  // v1.438.0: щелчок по строке больше НЕ копирует.
  //
  // В v1.408.0 я повесил копирование на сам щелчок по названию, и это оказалось
  // хуже, чем польза от него: строка лежит внутри ряда, у которого есть главное
  // действие — открыть переписку или профиль. Перехват съедал именно его, и
  // владелец описал это точно: «хочешь в ЛС зайти — и никак». Ряд, по которому
  // нельзя нажать, ломает больше, чем даёт возможность забрать название.
  //
  // Подсказка с полным названием остаётся: в узком ряду оно всё равно обрезано,
  // и прочитать его целиком иначе нечем. Скопировать название трека можно там,
  // где ряду это не мешает — в меню карточки трека в Трекотеке.
  const full = game.name + (game.mode ? ' — ' + game.mode : '')
  return <small className="member-act game" title={full}>
    <span className="mag-ico"><Icon name={gameIconOf(game.name)} size={14} /></span>
    <span className="mag-tx">
      {game.name}{game.mode && <span className="mag-mode"> — {game.mode}</span>}
    </span>
  </small>
}

// v1.381.0: «Слушает …» строкой под ником — рядом с игрой.
//
// Музыка публиковалась в присутствии наравне с игрой, но показывалась ровно в
// одном месте — в мини-профиле, куда надо ещё догадаться зайти. В списке
// участников её не было, и со стороны это выглядело как «другие не видят, что
// ты слушаешь»: данные доходили, показать их было негде.
/**
 * v1.423.0: поле с исполнителем называется author — как в присутствии.
 *
 * Здесь оно всё это время читалось как artist, которого в присутствии нет
 * вовсе: то есть в списке участников и в списке друзей исполнитель не
 * показывался НИ РАЗУ с самого появления строки, хотя приходил вместе с
 * названием. Типы это пропустили: поле было необязательным, лишние поля в
 * объекте разрешены.
 */
export function ListenLine({ l }: { l: { title: string; artist?: string | null; author?: string | null; art?: string | null } }) {
  const artist = l.artist || l.author || ''
  const full = l.title + (artist ? ' — ' + artist : '')
  // v1.438.0: щелчок по названию больше не копирует — см. GameLine выше, причина
  // та же и она важнее: он не давал открыть переписку.
  return <small className="member-act listen" title={'Слушает ' + full}>
    {/* v1.423.0: обложка трека вместо ноты-заглушки — так же, как у игры стоит
        её картинка. Ссылка приходит вместе с активностью; нет её — остаётся нота. */}
    {l.art
      ? <img className="mag-cover" src={l.art} alt="" loading="lazy" />
      : <span className="mag-ico"><Icon name="music" size={14} /></span>}
    {/* notr: это чужое название трека, переводить его нельзя. */}
    <span className="mag-tx notr" translate="no">
      {l.title}{artist && <span className="mag-mode"> — {artist}</span>}
    </span>
  </small>
}

// То же, но в строку — вкладка «Друзья» и карточки «Активные контакты».
export function GameInline({ game }: { game: Game }) {
  return <span className="game-inline">
    {game.cover ? <img className="mag-cover" src={game.cover} alt="" /> : <span className="mag-ico"><Icon name={gameIconOf(game.name)} size={14} /></span>}
    <span>Играет в <b>{game.name}</b>{game.mode && <span className="mag-mode"> — {game.mode}</span>}</span>
  </span>
}

/**
 * Полоса прослушивания — «сколько прошло и сколько осталось» (v1.423.0).
 *
 * Раньше в мини-профиле стоял тикающий счётчик «сколько играет»: ни длины
 * трека, ни места в песне. У себя в плеере это видно, у других — нет, хотя всё
 * нужное присутствие уже присылало.
 *
 * Позиция досчитывается локально (см. lib/listenProgress.ts): присутствие
 * освежается раз в пятнадцать секунд, и без досчёта полоса дёргалась бы раз в
 * пятнадцать секунд вместо того, чтобы идти ровно.
 */
export function ListenProgress({ l }: { l: Listening }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  const now = Date.now()
  // v1.428.0: на паузе полосы нет — она врала бы, что песня идёт. Вместо неё
  // прямо сказано «на паузе», и время застывает там, где остановились.
  if (l.paused) {
    return <div className="lsn-time lsn-paused">
      <span><Icon name="pause" size={12} /> На паузе</span>
      <span className="notr" translate="no">{fmtClock(l.pos)}</span>
    </div>
  }
  const pct = listenPct(l, now)
  const left = leftOver(l, now)
  const passed = fmtClock(livePos(l, now))
  // Длины трека может не быть вовсе (ссылка, у которой её не узнали) — тогда
  // полосу рисовать нечем, и мы показываем только прошедшее, а не выдумываем шкалу.
  if (pct === null || left === null) {
    return <div className="lsn-time"><span>{passed}</span></div>
  }
  return <div className="lsn-prog">
    <div className="lsn-bar"><i style={{ width: pct + '%' }} /></div>
    <div className="lsn-time">
      <span className="notr" translate="no">{passed}</span>
      <span className="notr" translate="no">осталось {fmtClock(left)}</span>
    </div>
  </div>
}
