// v1.417.0: что плагин может делать с музыкой.
//
// Почему отдельным файлом и через регистрацию. Плеер грузится лениво и живёт
// не всегда, а API плагинов существует с первой секунды. Если бы api.ts звал
// плеер напрямую, плеер уехал бы в стартовую сборку целиком — ради функции,
// которой пользуется один плагин из десяти.
//
// Поэтому плеер, пока он открыт, оставляет здесь набор своих действий, а
// плагин обращается к ним. Нет плеера — честный отказ «музыка сейчас не
// играет», а не тишина.
//
// Что плагину доступно и почему это безопасно:
//   • узнать, что играет, и список Трекотеки — это и так на экране у каждого;
//   • нажать паузу, следующий, предыдущий — то же, что нажать кнопку;
//   • поставить трек в очередь и добавить ссылку в Трекотеку — то же, что
//     сделал бы человек руками, и с теми же ограничениями базы.
// Чего плагину недоступно: сам звук. Ни одна дорожка сюда не попадает.

export interface MusicNow {
  id: string
  title: string
  author: string
  playing: boolean
  /** Секунда, на которой сейчас играет, и вся длина — как на полосе перемотки. */
  at: number
  duration: number
}

export interface MusicTrackInfo { id: string; title: string; author: string; plays: number }

export interface MusicBridge {
  now: () => MusicNow | null
  library: () => MusicTrackInfo[]
  play: () => void
  pause: () => void
  next: () => void
  prev: () => void
  /** Поставить трек следующим. false — такого трека в Трекотеке нет. */
  queue: (trackId: string) => boolean
  /** Добавить ссылку в Трекотеку. Возвращает причину отказа или null. */
  add: (url: string) => Promise<string | null>
}

let bridge: MusicBridge | null = null

/** Плеер открылся (или закрылся) — сообщает об этом сюда. */
export function setMusicBridge(b: MusicBridge | null) { bridge = b }
export function musicBridge(): MusicBridge | null { return bridge }
