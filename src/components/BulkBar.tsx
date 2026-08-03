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
import { confirmUi } from '../lib/confirm'
import { toastOk, toastErr } from '../lib/toast'
import {
  BULK_MAX, toggleOne, selectRange, pruneSelection, deletable, skippedCount,
  bulkLabel, skippedNote, runBulk, bulkReport,
} from '../lib/bulkSelect'

export function useBulkSelect<T extends { id: string }>(
  all: readonly T[],
  can: (m: T) => boolean,
  del: (id: string) => Promise<boolean>,
) {
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

  const list = deletable(sel, all, can)
  const skipped = skippedCount(sel, all, can)
  const over = pruneSelection(sel, all).size > BULK_MAX

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
  const bar = mode ? (
    <div className="bulk-bar">
      <button className="bulk-x" title="Выйти из выбора" onClick={stop}><Icon name="close" size={15} /></button>
      <div className="bulk-tx">
        <b>{list.length > 0 ? bulkLabel(list.length).replace('Удалить ', 'Выбрано: ') : 'Ничего не выбрано'}</b>
        {note && <span>{note}</span>}
      </div>
      <button className="bulk-go" disabled={!list.length || busy} onClick={remove}>
        <Icon name="trash" size={14} /> {busy ? 'Удаляю…' : bulkLabel(list.length) || 'Удалить'}
      </button>
    </div>
  ) : null

  return {
    bar,
    /** Пропы для MessageList — раскладываются одним spread. */
    listProps: { selectMode: mode, selected: sel, onSelectToggle: toggle, onSelectStart: start },
  }
}
