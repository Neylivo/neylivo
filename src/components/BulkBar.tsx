// v1.445.0: полоса «выбрано N — удалить», общая для серверных каналов и ЛС.
//
// Зачем общим файлом. Оба чата (ServerView и DMHome) устроены одинаково, и
// раньше всё, что делалось для одного, приходилось повторять во втором — так
// уже расходились подгрузка старых сообщений и счётчик непрочитанного. Здесь
// вся работа режима выбора лежит в одном крючке, а каждому чату остаётся две
// строки: полоса и пропы для ленты.
//
// Считает, что именно удалится, src/lib/bulkSelect.ts — та же функция, что
// рисует число на кнопке. Показ и действие тут физически не могут разойтись.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { ForwardModal, type FwdSource } from './ForwardModal'
import { confirmUi } from '../lib/confirm'
import { toastOk, toastErr } from '../lib/toast'
import {
  BULK_MAX, toggleOne, selectRange, pruneSelection, deletable, skippedCount,
  bulkLabel, skippedNote, runBulk, bulkReport,
} from '../lib/bulkSelect'

/**
 * v1.508.0: из режима выбора можно не только удалять, но и пересылать.
 *
 * Владелец: «при выборе сообщений кроме удаления можно ещё и переслать».
 *
 * ВАЖНАЯ РАЗНИЦА, из-за которой числа на двух кнопках РАЗНЫЕ. Удалить можно
 * только своё (и только там, где есть право), а переслать — любое: чтобы
 * показать чужое сообщение другу, разрешений не нужно. Значит «Удалить 3» и
 * «Переслать 7» на одной полосе — это не ошибка, а правда, и считаются они по
 * отдельности. Пусть лучше числа не совпадают, чем кнопка обещает больше, чем
 * сделает.
 *
 * `кто` необязателен: без него кнопки пересылки не будет вовсе — это лучше
 * кнопки, которая ничего не делает. Само окно пересылки живёт здесь же, а не в
 * каждом чате отдельно: два одинаковых куска в ServerView и DMHome — это ровно
 * тот способ, которым в этом проекте уже расходились подгрузка старых
 * сообщений и счётчик непрочитанного.
 */
export function useBulkSelect<T extends { id: string }>(
  all: readonly T[],
  can: (m: T) => boolean,
  del: (id: string) => Promise<boolean>,
  кто?: { meId: string; meName: string },
) {
  const [пересылка, setПересылка] = useState<FwdSource[] | null>(null)
  const [mode, setMode] = useState(false)
  const [sel, setSel] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const anchor = useRef<string | null>(null)

  // Сообщение могли удалить с другого устройства: «выбрано 5» при четырёх
  // строках — это ложь, и удалять по такому списку тоже нечего.
  useEffect(() => {
    if (!mode) return
    setSel(s => {
      const next = pruneSelection(s, all)
      return next.size === s.size ? s : next
    })
  }, [all, mode])

  const stop = () => { setMode(false); setSel(new Set()); anchor.current = null }

  // Escape выходит из режима — как из любого другого временного состояния в
  // приложении. Без этого выйти можно было только кнопкой.
  useEffect(() => {
    if (!mode) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); stop() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [mode])

  const start = (id: string) => { setMode(true); setSel(new Set([id])); anchor.current = id }
  const toggle = (id: string, shift: boolean) => {
    setSel(s => (shift ? selectRange(s, all, anchor.current, id) : toggleOne(s, id)))
    anchor.current = id
  }

  // Пока режим выключен, перебирать ленту незачем: чат перерисовывается часто, и
  // три прохода по всем сообщениям на каждую перерисовку — это плата ни за что.
  const list = mode ? deletable(sel, all, can) : []
  const skipped = mode ? skippedCount(sel, all, can) : 0
  const over = mode && pruneSelection(sel, all).size > BULK_MAX
  // Переслать можно ВСЁ выбранное, а не только своё. Порядок — ленты, а не
  // нажатий: пересланный разговор должен читаться так же, как шёл.
  const forwardable = mode
    ? (all.filter(m => pruneSelection(sel, all).has(m.id)) as unknown as FwdSource[])
    : []

  async function remove() {
    if (!list.length || busy) return
    if (!await confirmUi(bulkLabel(list.length) + '? Это действие необратимо.', { okText: 'Удалить' })) return
    setBusy(true)
    try {
      const r = await runBulk(list, del)
      // Говорим то, что произошло на самом деле: «удалено 12» при девяти ушедших
      // — ровно та ложь, ради отсутствия которой всё это считается одной функцией.
      if (r.failed) toastErr(bulkReport(r))
      else toastOk(bulkReport(r))
      stop()
    } finally { setBusy(false) }
  }

  const note = skippedNote(skipped, over)
  const полоса = mode ? (
    <div className="bulk-bar">
      <button className="bulk-x" title="Выйти из выбора" onClick={stop}><Icon name="close" size={15} /></button>
      <div className="bulk-tx">
        <b>{list.length > 0 ? bulkLabel(list.length).replace('Удалить ', 'Выбрано: ') : 'Ничего не выбрано'}</b>
        {note && <span>{note}</span>}
      </div>
      {кто && <button className="bulk-fwd" disabled={!forwardable.length || busy}
        title="Переслать выбранное"
        onClick={() => { setПересылка(forwardable); stop() }}>
        <Icon name="send" size={14} /> Переслать{forwardable.length ? ' ' + forwardable.length : ''}
      </button>}
      <button className="bulk-go" disabled={!list.length || busy} onClick={remove}>
        <Icon name="trash" size={14} /> {busy ? 'Удаляю…' : bulkLabel(list.length) || 'Удалить'}
      </button>
    </div>
  ) : null

  const bar = полоса
  const окно = пересылка && кто
    ? <ForwardModal src={пересылка} meId={кто.meId} meName={кто.meName} onClose={() => setПересылка(null)} />
    : null

  return {
    bar: (bar || окно) ? <>{bar}{окно}</> : null,
    /** Пропы для MessageList — раскладываются одним spread. */
    listProps: { selectMode: mode, selected: sel, onSelectToggle: toggle, onSelectStart: start },
  }
}
