// v1.438.0: звонок в приложении может быть только ОДИН.
//
// Что было. Личный звонок и голосовой канал сервера ничего друг о друге не
// знали: `joinVoice` отключал только предыдущий канал, `startCall` — только
// предыдущий личный звонок. Поэтому можно было сидеть сразу в двух: два
// микрофона в эфире, два потока звука в наушниках, две панели управления, и обе
// шлют своё состояние наружу одним и тем же событием. Владелец описал
// последствия коротко: «выходя из звонка всё ломается» — выход из одного
// оставлял второй в непонятном виде.
//
// Теперь есть одно место, которое знает, где мы сейчас, и умеет оттуда выйти.
// Заходя куда угодно, сначала выходим отсюда.

export type CallKind = 'dm' | 'server'
export interface ActiveCall {
  kind: CallKind
  /** Идентификатор комнаты: id диалога или id канала. */
  id: string
  /** Как отсюда выйти. Зовётся ровно один раз. */
  leave: () => void
}

/**
 * Надо ли выходить из текущего звонка, чтобы войти в новый.
 *
 * Тот же самый звонок повторным входом не считается: в Discord нажатие на свой
 * же канал просто открывает его вид, а не перезаходит (и не рвёт разговор).
 */
export function shouldLeave(cur: { kind: CallKind; id: string } | null, next: { kind: CallKind; id: string }): boolean {
  if (!cur) return false
  return !(cur.kind === next.kind && cur.id === next.id)
}

let current: ActiveCall | null = null

/** Где мы сейчас. Для показа и для проверок. */
export function activeCall(): { kind: CallKind; id: string } | null {
  return current ? { kind: current.kind, id: current.id } : null
}

/**
 * Занять место: выйти из прежнего звонка, если он другой, и записать новый.
 * Возвращает true, если пришлось откуда-то выйти.
 */
export function takeCall(next: ActiveCall): boolean {
  const left = shouldLeave(current, next)
  if (left) {
    const prev = current
    current = null                   // сначала снимаем, потом зовём: leave() обычно
    try { prev?.leave() } catch {}   // сам зовёт releaseCall, и мы не уйдём в круг
  }
  current = next
  return left
}

/** Освободить место. Чужой звонок не трогаем: выйти мог и старый обработчик. */
export function releaseCall(id?: string) {
  if (!current) return
  if (id && current.id !== id) return
  current = null
}
