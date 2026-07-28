import type { MouseEvent } from 'react'
import { confirmUi } from './confirm'

// Предупреждение при переходе по внешним ссылкам (как в Discord).
// Подтверждённые сайты запоминаются локально и больше не спрашиваются.

const KEY = 'ponoi_trusted_hosts'

function trusted(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function guardLink(e: MouseEvent, url: string) {
  // v1.378.0: раньше при непонятном адресе функция просто выходила — и переход
  // происходил сам собой, без спроса. Защита, которая при сомнении пропускает,
  // защищает ровно до первой неожиданности.
  //
  // Через разметку сюда попадают только http(s) — ссылками становятся лишь они
  // (URL_RE в md.tsx). Но полагаться на это нельзя: у guardLink может появиться
  // другой вызывающий, и тогда «не разобрали — пропустили» станет дырой.
  // Не разобрали или не http(s) — не пускаем вовсе.
  let u: URL
  try { u = new URL(url) } catch { e.preventDefault(); return }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') { e.preventDefault(); return }
  const host = u.hostname
  if (!host) { e.preventDefault(); return }
  if (trusted().includes(host)) return
  e.preventDefault()
  confirmUi('Переход на внешний сайт: ' + host + '. Открыть ссылку? Этот сайт больше не будет спрашиваться.', { okText: 'Открыть' })
    .then(ok => {
      if (!ok) return
      try { localStorage.setItem(KEY, JSON.stringify(Array.from(new Set([...trusted(), host])))) } catch {}
      window.open(url, '_blank', 'noopener,noreferrer')
    })
}
