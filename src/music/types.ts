export interface Track { id: string; url: string; name: string; owner: string }
export type GifPos = 'left' | 'right' | 'both'
export interface GifCfg { url: string; pos: GifPos }
export interface BgCfg {
  type: 'none' | 'photo' | 'video'
  mode: 'url' | 'file'
  url: string        // url (mode=url) OR '' when file is in IndexedDB
  dim: number        // 0..80 (%)
  ver: number        // bump to force reload of the file blob
}
export const GIF_KEY = 'ponoi_mus_gif_v1'
export const BG_KEY = 'ponoi_mus_bg_v1'
export const BG_IDB_KEY = 'musbg'
