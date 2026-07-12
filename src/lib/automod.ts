// v1.267.0: реальные проверки для автомодерации сервера (ServerSettings.tsx →
// вкладка «Автомод»). «Свои слова» подключены с v1.264.0 (простое совпадение
// подстроки, прямо в ServerView.tsx) — здесь добавлены оставшиеся два фильтра:
// спам-упоминания и спам-подобный контент.

// Спам-упоминания: сообщение упоминает больше limit РАЗНЫХ людей/ролей разом
// (массовая рассылка @людей — типичный спам-паттерн, отдельно от нормального
// «ответил троим в одном сообщении»).
export function countMentions(text: string): number {
  const matches = text.match(/@[a-zA-Zа-яА-ЯёЁ0-9_.]+/g) ?? []
  return new Set(matches.map(m => m.toLowerCase())).size
}

// Спам-подобный контент: длинный пробег одного и того же символа/короткой
// группы символов (эмодзи-спам, «!!!!!!!!», «ХАХАХАХАХАХАХА») или одно и то же
// слово/фраза, повторённая много раз подряд («купи купи купи купи купи»).
export function isSpamLike(text: string): boolean {
  const t = text.trim()
  if (t.length < 10) return false
  let run = 1
  for (let i = 1; i < t.length; i++) {
    run = t[i] === t[i - 1] ? run + 1 : 1
    if (run > 12) return true
  }
  const words = t.toLowerCase().split(/\s+/).filter(w => w.length > 1)
  let wrun = 1
  for (let i = 1; i < words.length; i++) {
    wrun = words[i] === words[i - 1] ? wrun + 1 : 1
    if (wrun >= 5) return true
  }
  return false
}
