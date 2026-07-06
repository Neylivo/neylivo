import { useEffect, useState } from 'react'
import type { Activity, Game } from '../lib/presence'
import { Icon } from './icons'
import { gameIconOf } from '../lib/gameIcon'

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
  useEffect(() => {
    const t = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  return <>{activity.text} — {fmtElapsed(activity.since)}</>
}

// Просто тикающее время («5 мин 31 сек») без текста — для карточки игры в мини-профиле.
export function Elapsed({ since }: { since: number }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTick(v => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])
  return <>{fmtElapsed(since)}</>
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
  return <small className="member-act game">
    <span className="mag-ico"><Icon name={gameIconOf(game.name)} size={14} /></span>
    <span className="mag-tx">{game.name}{game.mode && <span className="mag-mode"> — {game.mode}</span>}</span>
  </small>
}

// То же, но в строку — вкладка «Друзья» и карточки «Активные контакты».
export function GameInline({ game }: { game: Game }) {
  return <span className="game-inline">
    {game.cover ? <img className="mag-cover" src={game.cover} alt="" /> : <span className="mag-ico"><Icon name={gameIconOf(game.name)} size={14} /></span>}
    <span>Играет в <b>{game.name}</b>{game.mode && <span className="mag-mode"> — {game.mode}</span>}</span>
  </span>
}
