// v1.436.0: что именно рассылается о человеке и что из этого показывается.
//
// Зачем отдельным файлом. Присутствие публиковалось ПЯТЬЮ разными местами, и
// каждое собирало объект руками: подписка на канал, смена своей активности,
// смена игры (два места) и смена музыки. Копии уже разъехались — в одной из них
// имя и аватарка брались из замыкания, а не из свежих значений, то есть после
// смены ника музыка публиковалась со старым именем. Такое расходится тихо и
// навсегда: поле просто пропадает у части людей.
//
// Теперь состав присутствия собирает одна функция, а показ («что человек
// делает») считает вторая — и обе проверяются.
import type { Activity, Game, Listening, Status } from './presence'
import { shareLabel } from './campaign'

/**
 * Голосовое состояние (v1.436.0) — этого в присутствии не было вовсе.
 *
 * В Discord «В голосовом канале» и «Демонстрирует экран» видны всем и меняются
 * мгновенно: это и есть та самая активность, которой не хватало. Держим ровно
 * то, что показываем, и ни байтом больше — присутствие рассылается всем.
 */
export interface Voice {
  /** Где: название канала или имя собеседника. Пусто — «в звонке». */
  where?: string | null
  /** Демонстрирует экран. */
  screen?: boolean
  /** Включена камера. */
  cam?: boolean
  /** Заглушен микрофон. */
  muted?: boolean
  /** Когда вошёл (мс) — по нему тикает время в звонке. */
  since: number
}

export interface PresenceMeta {
  username: string
  status: Status
  avatar_url: string | null
  activity: Activity | null
  listening: Listening | null
  game: Game | null
  voice: Voice | null
  device: 'mobile' | 'desktop'
}

export interface MetaInput {
  username: string
  avatarUrl?: string | null
  activity: Activity | null
  listening: Listening | null
  game: Game | null
  voice: Voice | null
  device: 'mobile' | 'desktop'
}

/** Собрать то, что рассылается о себе. Одно место на все публикации. */
export function buildMeta(i: MetaInput): PresenceMeta {
  return {
    username: i.username,
    status: 'online',
    avatar_url: i.avatarUrl ?? null,
    activity: i.activity ?? null,
    listening: i.listening ?? null,
    game: i.game ?? null,
    voice: i.voice ?? null,
    device: i.device,
  }
}

/**
 * Изменилось ли то, что стоит рассылать.
 *
 * Присутствие уходит всем сразу, поэтому слать его на каждое движение мыши
 * нельзя, а держать «раз в пятнадцать секунд» — значит показывать вчерашнее.
 * Сравниваем по существу: позиция трека меняется постоянно и сама по себе
 * поводом не является (её досчитывают локально, см. listenProgress), а вот
 * начало и конец, пауза, смена трека, игры, голосового состояния — являются.
 */
export function metaChanged(a: PresenceMeta | null, b: PresenceMeta): boolean {
  if (!a) return true
  if (a.username !== b.username || a.avatar_url !== b.avatar_url || a.device !== b.device) return true
  if ((a.activity?.text ?? '') !== (b.activity?.text ?? '')) return true
  if ((a.game?.name ?? '') !== (b.game?.name ?? '') || (a.game?.mode ?? '') !== (b.game?.mode ?? '')) return true
  if ((a.game?.cover ?? '') !== (b.game?.cover ?? '')) return true
  const la = a.listening, lb = b.listening
  if (!!la !== !!lb) return true
  if (la && lb && (la.title !== lb.title || la.author !== lb.author || !!la.paused !== !!lb.paused || la.art !== lb.art)) return true
  const va = a.voice, vb = b.voice
  if (!!va !== !!vb) return true
  if (va && vb && (!!va.screen !== !!vb.screen || !!va.cam !== !!vb.cam || !!va.muted !== !!vb.muted || (va.where ?? '') !== (vb.where ?? ''))) return true
  return false
}

/**
 * Что человек делает — одной строкой, по важности.
 *
 * Порядок как в Discord: демонстрация экрана — самое заметное (её можно
 * открыть и посмотреть), потом голос, потом игра, музыка и своя строка. До
 * v1.436.0 голоса тут не было вовсе: человек сидел в звонке и делился экраном, а
 * у всех значилось «Не в сети» или прошлая игра.
 */
export type WhatKind = 'screen' | 'voice' | 'game' | 'music' | 'custom' | 'none'
export interface What { kind: WhatKind; text: string; since: number }

export function whatIsDoing(p: {
  voice?: Voice | null; game?: Game | null; listening?: Listening | null; activity?: Activity | null
}): What {
  // v1.439.0: просто «в голосовом канале» активностью больше НЕ считается — по
  // просьбе владельца. Сидеть в звонке и что-то делать — разные вещи, а строка
  // перекрывала собой игру и музыку у всех, кто просто держит канал открытым.
  // Демонстрация экрана осталась: её можно открыть и посмотреть.
  const v = p.voice
  if (v?.screen) return { kind: 'screen', text: 'Демонстрирует экран' + (v.where ? ' · ' + v.where : ''), since: v.since }
  const g = p.game
  if (g) {
    // v1.452.0: у сюжетной игры показываем место прохождения — «Миссия 8 из 20 ·
    // 35%». Считает это shareLabel из campaign.ts, та же функция, что и у себя в
    // панели: иначе своё и чужое разошлись бы в написании.
    const story = shareLabel(g.story)
    const tail = g.mode ? ': ' + g.mode : story ? ' · ' + story : ''
    return { kind: 'game', text: 'Играет в ' + g.name + tail, since: g.since }
  }
  const l = p.listening
  if (l) {
    return {
      kind: 'music',
      text: 'Слушает: ' + l.title + (l.author ? ' — ' + l.author : ''),
      since: l.at - Math.floor((l.pos || 0) * 1000),
    }
  }
  const a = p.activity
  if (a?.text) return { kind: 'custom', text: a.text, since: a.since }
  return { kind: 'none', text: '', since: 0 }
}
