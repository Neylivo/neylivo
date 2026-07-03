import type { MouseEvent } from 'react'
import { confirmUi } from './confirm'

// Предупреждение при переходе по внешним ссылкам (как в Discord).
// Подтверждённые сайты запоминаются локально и больше не спрашиваются.

const KEY = 'ponoi_trusted_hosts'

function trusted(): string[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function guardLink(e: MouseEvent, url: string) {
  let host = ''
  try { host = new URL(url).hostname } catch { return }
  if (!host || trusted().includes(host)) return
  e.preventDefault()
  confirmUi('Переход на внешний сайт: ' + host + '. Открыть ссылку? Этот сайт больше не будет спрашиваться.', { okText: 'Открыть' })
    .then(ok => {
      if (!ok) return
      try { localStorage.setItem(KEY, JSON.stringify(Array.from(new Set([...trusted(), host])))) } catch {}
      window.open(url, '_blank', 'noopener,noreferrer')
    })
}
