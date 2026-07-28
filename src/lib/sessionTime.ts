/**
 * Сколько длилась сессия (v1.363.0).
 *
 * Что было не так. Незакрытая сессия считалась «до сих пор» и обрезалась восемью
 * часами. Но ended_at пишется только при штатном закрытии приложения — а его
 * убивают, оно падает, компьютер уходит в сон. Каждая такая запись превращалась
 * в восемь часов игры, и на профиле выходило «135 ч 39 мин · сессий: 20», то
 * есть по 6,8 часа за сессию. Числа выглядели чужими, потому что не были похожи
 * на правду.
 *
 * Теперь открытая сессия считается только пока она правдоподобно идёт — не
 * дольше MAX_OPEN_MS от начала. Всё, что старше, — это брошенная запись, и
 * честнее не знать её длительность, чем выдумать восемь часов.
 */
const MAX_SESSION_MS = 8 * 3600000
const MAX_OPEN_MS = 8 * 3600000

export function sessionMs(startedAt: string | number, endedAt: string | number | null, now = Date.now()): number {
  const s = typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime()
  if (!isFinite(s)) return 0
  if (endedAt) {
    const e = typeof endedAt === 'number' ? endedAt : new Date(endedAt).getTime()
    if (!isFinite(e)) return 0
    return Math.min(Math.max(0, e - s), MAX_SESSION_MS)
  }
  // Открытая запись: засчитываем, только если она могла ещё идти.
  const open = now - s
  if (open < 0) return 0
  return open <= MAX_OPEN_MS ? open : 0
}
