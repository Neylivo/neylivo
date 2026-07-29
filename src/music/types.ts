
export interface Track {
  id: string; url: string; name: string; owner: string
  kind?: 'url' | 'file'; author?: string; art?: string | null; dur?: number; play?: string | null
  /** Сколько раз слушали все (v1.377.0). Нет колонки — нет и числа. */
  plays?: number
}
export type GifPos = 'left' | 'right' | 'both'
export interface GifCfg { url: string; pos: GifPos }
export interface BgCfg {
  type: 'none' | 'photo' | 'video'
  mode: 'url' | 'file'
  url: string        // url (mode=url) OR '' when file is in IndexedDB
  dim: number        // 0..80 (%)
  ver: number        // bump to force reload of the file blob
}
// v1.394.0: текст песни в полноэкранном плеере.
//   off     — не показывать вовсе;
//   back    — фоном за обложкой, приглушённо;
//   karaoke — вместо обложки, строку за строкой, с подсветкой поющейся.
// Караоке работает только на тексте с метками времени (LRC): без них угадать,
// когда какая строка звучит, нельзя — тогда показываем текст фоном и говорим,
// почему.
export type LyricsMode = 'off' | 'back' | 'karaoke'
export interface LyricsCfg {
  mode: LyricsMode
  /** Искать текст на lrclib.net. Выключено по умолчанию: запрос уходит наружу. */
  online: boolean
}

export const GIF_KEY = 'ponoi_mus_gif_v1'
export const LYRICS_KEY = 'ponoi_mus_lyrics_cfg_v1'
export const BG_KEY = 'ponoi_mus_bg_v1'
export const BG_IDB_KEY = 'musbg'
export const TRACKS_KEY = 'ponoi_mus_tracks_v1'  // persisted URL-tracks only (file tracks are object-URL, not persisted)
