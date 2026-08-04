// v1.463.0: подсчёт истории активностей — отдельным файлом, без базы.
//
// Зачем отдельно. Здесь семь величин на игру, и каждая считается по-своему:
// серия дней подряд, самая длинная сессия, пауза перед возвращением. Ошибка в
// любой из них выглядит как «история немного сломана», и разобрать глазами, что
// именно не так, нельзя.
//
// А проверить это, пока подсчёт лежал рядом с запросами к базе, было невозможно:
// файл тянет за собой всё подключение. Теперь считает этот файл, а ходит в базу
// соседний.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui).
import { sessionMs } from './sessionTime'

export interface RecentGame {
  name: string
  last: number        // старт последней сессии
  totalMs: number
  sessions: number
  streak: number      // дней подряд, заканчивая днём последней сессии
  longestMs: number   // самая длинная сессия
  gapDays: number     // пауза перед последней сессией (для «Снова в деле…»)
  isNew: boolean      // самая первая сессия игры была в последние 14 дней
}

/** Одна запись о сессии — то, что приходит из базы. */
export interface SessionRow { name: string; started_at: string; ended_at: string | null }

/**
 * Подсчёт истории — отдельной чистой функцией (v1.463.0).
 *
 * Зачем вынесено: тут семь величин на игру, и каждая считается по-своему —
 * серия дней подряд, самая длинная сессия, пауза перед возвращением. Ошибка в
 * любой из них выглядит как «история немного сломана», и разобрать глазами, что
 * именно не так, нельзя. Пусть падает проверка.
 *
 * Порядок строк на входе НЕ важен: раньше подсчёт молча полагался на то, что они
 * идут от старых к новым, — а из базы теперь приходят свежие сверху.
 */
export function aggregateSessions(rows: readonly SessionRow[], now = Date.now()): RecentGame[] {
  const by: Record<string, { s: number; e: number }[]> = {}
  for (const r of rows) {
    if (!r?.name || !r.started_at) continue
    const s = new Date(r.started_at).getTime()
    if (!Number.isFinite(s)) continue
    // Держим и длительность: считать её из e - s заново значило бы обойти
    // правило про брошенные записи, ради которого она и появилась.
    ;(by[r.name] ?? (by[r.name] = [])).push({ s, e: s + sessionMs(r.started_at, r.ended_at) })
  }
  // Внутри каждой игры — по времени. Без этого «последняя сессия» и «серия
  // дней» считались бы по случайному порядку выдачи.
  for (const name of Object.keys(by)) by[name].sort((a, b) => a.s - b.s)
  return собрать(by, now)
}

function собрать(by: Record<string, { s: number; e: number }[]>, now: number): RecentGame[] {
  {
    const out: RecentGame[] = []
    const cutoff30 = now - 30 * 86400000
    for (const name of Object.keys(by)) {
      const rows = by[name]
      const last = rows[rows.length - 1]
      if (last.s < cutoff30) continue   // показываем только то, во что играли за 30 дней
      const days = new Set(rows.map(r => Math.floor(r.s / 86400000)))
      let streak = 1
      const lastDay = Math.floor(last.s / 86400000)
      while (days.has(lastDay - streak)) streak++
      const prev = rows.length > 1 ? rows[rows.length - 2] : null
      const dur = (r: { s: number; e: number }) => Math.max(0, r.e - r.s)
      out.push({
        name,
        last: last.s,
        totalMs: rows.reduce((a, r) => a + dur(r), 0),
        sessions: rows.length,
        streak,
        longestMs: Math.max(...rows.map(dur)),
        gapDays: prev ? Math.floor((last.s - prev.e) / 86400000) : 0,
        isNew: rows[0].s > now - 14 * 86400000,
      })
    }
    return out.sort((a, b) => b.last - a.last)
  }
}
