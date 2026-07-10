import { useEffect, useState } from 'react'
import { Em } from '../lib/twemoji'
import { loadCustom } from '../lib/emoji'
import { chFontFamily } from '../lib/chStyle'
import { resolveUserTag, onTagChange, type ResolvedTag } from '../lib/userTag'

// v1.178.0: вынесено из ServerSettings.tsx — теперь тег сервера рисуется не только
// в настройках (превью), но и рядом с ником участника, который его носит.
export interface ServerTag { name?: string; icon?: string; color?: string; font?: string; fontUrl?: string }

// Значок тега — обычный эмодзи ИЛИ кастомный эмодзи сервера (:имя:), как в реакциях/сообщениях.
export function TagEmoji({ e }: { e: string }) {
  const mm = e.match(/^:([a-zA-Z0-9_]+):$/)
  const url = mm ? loadCustom()[mm[1]] : undefined
  if (url) return <img className="tag-cust-emoji" src={url} alt={e} draggable={false} />
  return <Em>{e}</Em>
}

// Шрифт тега: свой файл (fontUrl, через chFontFamily — тот же @font-face-механизм,
// что у шрифта названий каналов) или пресет CH_FONTS (тот же набор, что у шрифта ника).
export function tagFontFamily(tag?: { font?: string; fontUrl?: string }): string | undefined {
  if (!tag) return undefined
  if (tag.fontUrl) return chFontFamily(tag.fontUrl)
  return tag.font || undefined
}

// Целая карточка-чип тега — иконка + название, цвет фона/текста из настроек тега.
// Общий рендер для превью в настройках, модалки «взять тег» и бейджа у ника.
export function TagChip({ tag, big }: { tag: ServerTag; big?: boolean }) {
  if (!tag.name) return null
  return (
    <span className={'sset-tagchip' + (big ? ' big' : '')}
      style={{ background: (tag.color ?? '#5865f2') + '33', color: tag.color ?? '#5865f2', fontFamily: tagFontFamily(tag) }}>
      {tag.icon && <TagEmoji e={tag.icon} />} {tag.name}
    </span>
  )
}

// v1.178.0: бейдж тега рядом с ником — самодостаточный, сам подгружает и кэширует
// (см. src/lib/userTag.ts), поэтому не требует прокидывать проп через весь путь
// компонентов, где показывается имя пользователя (сообщения, список участников...).
export function UserTagBadge({ userId }: { userId: string }) {
  const [tag, setTag] = useState<ResolvedTag | null>(null)
  useEffect(() => {
    let ok = true
    const load = () => resolveUserTag(userId).then(t => { if (ok) setTag(t) })
    load()
    const off = onTagChange(load)
    return () => { ok = false; off() }
  }, [userId])
  if (!tag) return null
  return (
    <span className="user-tag-badge" title={tag.serverName}
      style={{ background: (tag.color ?? '#5865f2') + '33', color: tag.color ?? '#5865f2', fontFamily: tagFontFamily(tag) }}>
      {tag.icon && <TagEmoji e={tag.icon} />} {tag.name}
    </span>
  )
}
