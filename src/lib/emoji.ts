
// Emoji list for the picker + custom-emoji store (:name: -> image url) kept in localStorage.
export const EMOJI_GROUPS: { title: string; emojis: string[] }[] = [
  { title: 'Часто используемые', emojis: ['😂','❤️','👍','🔥','😭','🥺','😍','🎉','💀','✨','🙏','👀'] },
  { title: 'Смайлы', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😊','🙂','😉','😌','😍','🥰','😘','😗','😜','🤪','😝','🤗','🤔','🤨','😐','😶','🙄','😏','😴','🤤','😪','😷','🤒','🤕','🤢','🤮','🥶','🥵','😎','🤓','🧐'] },
  { title: 'Жесты', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤙','👏','🙌','👐','🤝','🙏','💪','👀','🫶','🤲'] },
  { title: 'Сердца', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'] },
  { title: 'Разное', emojis: ['🔥','✨','🎉','🎊','⭐','🌟','💥','💫','🎵','🎶','💯','✅','❌','⚡','🌈','🍕','🍺','☕','🎮','⚽'] },
]

const CUSTOM_KEY = 'ponoi_custom_emoji_v1'
export type CustomEmoji = Record<string, string> // name -> url

export function loadCustom(): CustomEmoji {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}') } catch { return {} }
}
export function saveCustom(map: CustomEmoji) { localStorage.setItem(CUSTOM_KEY, JSON.stringify(map)) }
export function addCustom(name: string, url: string): CustomEmoji {
  const clean = name.trim().replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()
  if (!clean || !url.trim()) return loadCustom()
  const map = loadCustom(); map[clean] = url.trim(); saveCustom(map); return map
}
export function removeCustom(name: string): CustomEmoji {
  const map = loadCustom(); delete map[name]; saveCustom(map); return map
}
