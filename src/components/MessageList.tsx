import { Fragment, useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { Attachment } from './Composer'
import { timeShort, timeFull, dayLabel, msgTime } from '../lib/ui'
import { renderMd, mentionsUser } from '../lib/md'
import type { RxSummary } from '../lib/reactions'
import { Icon } from './icons'
import { useSettings } from '../lib/settings'
import { useUserFonts, type UserFonts } from '../lib/userFonts'
import { toastOk, toastErr } from '../lib/toast'
import { parseSys, fmtCallDur, parseInviteMeta, parseQuickLaunchMeta } from '../lib/sysmsg'
import { isQuicklaunchAvailable } from '../lib/quicklaunch'
import { copyMedia, copyGif, saveMedia, copyText } from '../lib/copyMedia'
import { findGifLink, resolveGif, cachedGif } from '../lib/gifUrl'
import { buildMsgLink, type MsgLinkCtx } from '../lib/deepLink'
import { findYouTubeLink, ytMeta } from '../music/sources'
import type { ScMeta } from '../music/soundcloud'
import { guardLink } from '../lib/linkguard'

// v1.81.0: числа и склонения для карточки-приглашения (как в Discord)
const fmtN = (n: number) => n.toLocaleString('ru-RU')
function ruMembers(n: number): string {
  const d = n % 100
  if (d >= 11 && d <= 14) return 'участников'
  const r = n % 10
  return r === 1 ? 'участник' : r >= 2 && r <= 4 ? 'участника' : 'участников'
}
// v1.180.0: «1 мод / 2 мода / 5 модов» — для карточки «Игровой Экспресс».
function modsWord(n: number): string {
  const d = n % 100
  if (d >= 11 && d <= 14) return 'модов'
  const r = n % 10
  return r === 1 ? 'мод' : r >= 2 && r <= 4 ? 'мода' : 'модов'
}
import { parseFwd } from '../lib/fwd'
import { ForwardModal } from './ForwardModal'
import { EmojiPicker } from './EmojiPicker'
import { UserTagBadge } from './TagEmoji'

export interface UiMessage {
  id: string
  author: string
  author_name: string
  content?: string | null
  created_at: string
  attach_url?: string | null
  attach_type?: string | null
  attach_meta?: ({ name?: string; desc?: string } | null)[] | null
  author_avatar?: string | null
  pinned?: boolean
  reply_to?: string | null
  reply_author?: string | null
  reply_preview?: string | null
  edited?: boolean
  // v1.176.0: React-ключ, стабильный поверх смены id при подтверждении отправки
  // (tmp-id -> настоящий id с сервера) — без него узел сообщения на секунду
  // размонтировался и анимация появления проигрывалась второй раз.
  _localId?: string
}

import { Em } from '../lib/twemoji'
import { loadCustom } from '../lib/emoji'

// v1.129.0: эмодзи реакции — кастомные (:имя:) рендерятся картинкой из общего
// стора, юникодные — как обычно через Twemoji. Список сообщений уже
// перерисовывается по событию 'ponoi-custom-emoji', так что картинка появится,
// как только кэш кастомных эмодзи догрузится.
function RxEmoji({ e }: { e: string }) {
  const mm = e.match(/^:([a-zA-Z0-9_]+):$/)
  const url = mm ? loadCustom()[mm[1]] : undefined
  if (url) return <img className="rx-cust" src={url} alt={e} draggable={false} />
  return <Em>{e}</Em>
}

const QUICK = ['👍', '❤️', '😂', '🔥', '🎉', '😢']

// Прыжок к сообщению: плавный скролл + подсветка-вспышка (как в Discord).
export function jumpToMessage(id: string) {
  const el = document.getElementById('msg-' + id)
  if (!el) { toastErr('Сообщение вне загруженной истории'); return }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('msg-flash')
  window.setTimeout(() => el.classList.remove('msg-flash'), 1600)
}

// v1.163.0: плавающая дата при скролле старой истории (как в Slack/Telegram) — показывает
// дату верхнего видимого дня и сама прячется, если прокрутка остановилась у самого начала.
function StickyDatePill() {
  const ref = useRef<HTMLDivElement>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    const el = ref.current
    const container = el?.closest('.msgs') as HTMLElement | null
    if (!container) return
    const onScroll = () => {
      const top = container.getBoundingClientRect().top
      const seps = container.querySelectorAll('.day-sep')
      let cur: string | null = null
      for (const s of Array.from(seps)) {
        if (s.getBoundingClientRect().top - top <= 36) cur = s.textContent
        else break
      }
      if (el) el.style.top = container.scrollTop + 8 + 'px'
      setLabel(cur)
      setVisible(!!cur && container.scrollTop > 40)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => setVisible(false), 1400)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => { container.removeEventListener('scroll', onScroll); if (hideTimer.current) window.clearTimeout(hideTimer.current) }
  }, [])

  return <div ref={ref} className={'sticky-date-pill' + (visible ? ' show' : '')}>{label}</div>
}

// Ссылка на картинку в тексте — показываем превью самой картинки под сообщением.
const IMG_URL = /https?:\/\/[^\s<>]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s<>]*)?/i
function firstImageUrl(text?: string | null): string | null {
  if (!text) return null
  const m = text.match(IMG_URL)
  return m ? m[0] : null
}

// v1.89.0: гифка по ссылке из любого места (в т.ч. страницы Tenor/Giphy, которые даёт
// «Копировать ссылку» в Discord) — резолвим в прямой URL и показываем как вложение.
function GifEmbed({ url, meta }: { url: string; meta?: import('./Lightbox').LightboxMeta }) {
  const [src, setSrc] = useState<string | null | undefined>(cachedGif(url))
  useEffect(() => {
    let on = true
    resolveGif(url).then(u => { if (on) setSrc(u) })
    return () => { on = false }
  }, [url])
  if (src === undefined) return <div className="gif-embed-ph" />
  if (src === null) return null   // резолв не удался — текст-ссылка остаётся видимой
  return <Attachment url={src} type="image" meta={meta} />
}

// Ссылка на видео YouTube в тексте — показываем карточку-превью под сообщением (как в Discord):
// красная полоса слева, лейбл «YouTube», канал, кликабельное название, превьюшка с кнопкой play.
function YouTubeEmbed({ url }: { url: string }) {
  const [meta, setMeta] = useState<ScMeta | null | undefined>(undefined)
  useEffect(() => {
    let on = true
    ytMeta(url).then(m => { if (on) setMeta(m) })
    return () => { on = false }
  }, [url])
  if (meta === undefined) return <div className="yt-embed-ph" />
  if (meta === null) return null   // не удалось получить метаданные — текст-ссылка остаётся видимой
  return (
    <div className="yt-embed">
      <div className="yt-embed-eyebrow">YouTube</div>
      {meta.author && <div className="yt-embed-author">{meta.author}</div>}
      <a className="yt-embed-title" href={url} target="_blank" rel="noopener noreferrer" onClick={e => guardLink(e, url)}>{meta.title}</a>
      {meta.art && <a className="yt-embed-thumb" href={url} target="_blank" rel="noopener noreferrer" onClick={e => guardLink(e, url)}>
        <img src={meta.art} alt="" draggable={false} />
        <span className="yt-embed-play"><Icon name="play" size={22} /></span>
      </a>}
    </div>
  )
}

// Сообщение состоит только из ссылки на гифку — прячем текст-ссылку, оставляем саму гифку (как в Discord).
// Важно: пока резолв не завершился (cachedGif === undefined) или провалился (null) — текст остаётся
// видимым, иначе сообщение с нерезолвящейся ссылкой (например, Tenor без ключа) станет невидимым совсем.
function isOnlyGifLink(m: UiMessage): boolean {
  if (m.attach_url || !m.content) return false
  const l = findGifLink(m.content)
  return !!l && m.content.trim() === l && !!cachedGif(l)
}

// Картинка сообщения (вложение-image или ссылка на картинку в тексте) — для пунктов меню с изображениями.
function msgImage(m: UiMessage): string | null {
  if (m.attach_url && m.attach_type === 'image') return m.attach_url.replace('#spoiler', '')
  const l = findGifLink(m.content)
  if (l) return cachedGif(l) ?? firstImageUrl(m.content)
  return firstImageUrl(m.content)
}

// v1.82.0: копирование/сохранение медиа переехало в src/lib/copyMedia.ts —
// универсальный вариант с фолбэком (копирует «что угодно»).

// «Зачитать сообщение» — озвучка через Web Speech API (как в Discord).
function speakMsg(m: UiMessage) {
  const text = parseFwd(m.content)?.text ?? m.content ?? ''
  if (!text) return
  try {
    const u = new SpeechSynthesisUtterance(m.author_name + ' говорит: ' + text)
    u.lang = 'ru-RU'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch { toastErr('Синтез речи недоступен') }
}

// Detect a message consisting solely of emoji (1..8) so it can render large.
function isEmojiOnly(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  try {
    const stripped = t.replace(/\s+/g, '')
    const re = /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D)+$/u
    const count = [...stripped.matchAll(/\p{Extended_Pictographic}/gu)].length
    return re.test(stripped) && count >= 1 && count <= 8
  } catch { return false }
}

// Рендер текста: мини-маркдаун Discord (жирный/курсив/код/цитаты/спойлеры/ссылки) + кастом-эмодзи.
function renderContent(text: string) {
  return renderMd(text)
}

// «Вы, Вася и ещё 2» — подпись для тултипа реакции.
function rxWho(users: string[], me?: string, resolve?: (id: string) => string | undefined, meName?: string): string {
  const names = users.map(u => (me && u === me) ? (meName || resolve?.(u) || localStorage.getItem('ponoi_username') || '?') : (resolve?.(u) ?? 'Кто-то'))
  if (names.length <= 3) return names.join(', ')
  return names.slice(0, 3).join(', ') + ' и ещё ' + (names.length - 3)
}

interface Props {
  messages: UiMessage[]
  reactions?: Record<string, RxSummary[]>
  currentUser?: string
  currentUserName?: string
  canPin?: (m: UiMessage) => boolean
  // v1.156.0: кто может удалить ЧУЖОЕ сообщение (право «Управление сообщениями»).
  // Без этого пропа — как раньше, только автор (используется в ЛС, где ролей нет).
  canDelete?: (m: UiMessage) => boolean
  onReact?: (id: string, emoji: string) => void
  onPin?: (id: string, pinned: boolean) => void
  onDelete?: (id: string) => void
  onReply?: (m: UiMessage) => void
  // v1.177.0: редактирование переехало в композер (как в Discord) — вместо
  // сохранения текста MessageList просто сообщает родителю, что редактируем ЭТО
  // сообщение; сам композер получает его текст и сохраняет через свой onSaveEdit.
  onStartEdit?: (m: UiMessage) => void
  // id сообщения, которое сейчас редактируется в композере — подсветить строку.
  editingId?: string | null
  // v1.157.0: правка одного вложения (спойлер/название/описание) — index в
  // группе, склеенной через '\n' (см. AttachPatch в src/lib/reactions.ts).
  onEditAttachment?: (messageId: string, index: number, patch: { spoiler?: boolean; name?: string; desc?: string }) => void | Promise<void>
  onProfile?: (m: UiMessage, x: number, y: number) => void
  newDividerId?: string | null
  ownerId?: string | null
  // Имя пользователя по id — для тултипа «кто поставил реакцию».
  nameOf?: (userId: string) => string | undefined
  // Цвет имени автора (цветные роли).
  colorOf?: (userId: string) => string | undefined
  // v1.174.0: значок роли рядом с ником в сообщении — как в Discord, значок высшей
  // роли автора среди тех его ролей, у которых значок вообще есть.
  iconOf?: (userId: string) => string | undefined
  // «Отметить как непрочитанное» — ставит разделитель НОВОЕ на это сообщение.
  onMarkUnread?: (m: UiMessage) => void
  // Контекст (сервер+канал или ЛС) для «Скопировать ссылку на сообщение» — без него ссылка
  // не может привести туда же, где было само сообщение.
  linkCtx?: MsgLinkCtx
}

export function MessageList({ messages, reactions = {}, currentUser, currentUserName, canPin, canDelete, onReact, onPin, onDelete, onReply, onStartEdit, editingId, onEditAttachment, onProfile, newDividerId, ownerId, nameOf, colorOf, iconOf, onMarkUnread, linkCtx }: Props) {
  const { settings } = useSettings()
  // v1.112.0: шрифты авторов (ник + сообщения) — видны всем; чужие отключаются настройкой.
  const fontsOf = useUserFonts(messages.map(m => m.author))
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [fwdFor, setFwdFor] = useState<UiMessage | null>(null)
  const [emojiAt, setEmojiAt] = useState<{ id: string; x: number; y: number } | null>(null)
  const [, setEmojiVer] = useState(0)

  // Re-render message bodies when the shared custom-emoji cache updates.
  useEffect(() => {
    const h = () => setEmojiVer(v => v + 1)
    window.addEventListener('ponoi-custom-emoji', h)
    return () => window.removeEventListener('ponoi-custom-emoji', h)
  }, [])

  // Перерисовать список, когда где-то отрезолвилась ссылка на гифку — иначе
  // сообщение из одной ссылки на гифку так и останется с текстом рядом с
  // картинкой (isOnlyGifLink читает кэш только на момент рендера).
  useEffect(() => {
    const h = () => setEmojiVer(v => v + 1)
    window.addEventListener('ponoi-gif-resolved', h)
    return () => window.removeEventListener('ponoi-gif-resolved', h)
  }, [])

  let lastAuthor = ''
  let lastTs = 0
  let lastDay = ''

  const menuMsg = menu ? messages.find(m => m.id === menu.id) : null

  return (
    <>
      <StickyDatePill />
      {messages.map(m => {
        // Системное сообщение («X закрепил сообщение») — компактная строка, как в Discord.
        const sys = parseSys(m.content)
        if (sys) {
          const sysDay = new Date(m.created_at).toDateString()
          const showSysDay = sysDay !== lastDay
          lastDay = sysDay
          lastAuthor = ''   // системная строка разрывает группировку сообщений
          return (
            <Fragment key={m._localId ?? m.id}>
              {showSysDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
              {sys.type === 'invite' ? (() => {
                // v1.81.0: карточка-приглашение 1-в-1 как в Discord: баннер,
                // иконка, галочка, «в сети»/«участников», дата основания,
                // описание и зелёная кнопка «Перейти на сервер».
                const inv = parseInviteMeta(sys.preview)
                const founded = inv.c ? new Date(inv.c).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : null
                return (
                  <div className="inv2-card">
                    <div className="inv2-lb">{currentUser && m.author === currentUser ? 'Вы отправили приглашение присоединиться к серверу' : m.author_name + ' приглашает вас присоединиться к серверу'}</div>
                    <div className="inv2-box">
                      {inv.bn && <div className="inv2-banner" style={{ backgroundImage: `url(${inv.bn})` }} />}
                      <div className={'inv2-body' + (inv.bn ? ' has-bn' : '')}>
                        <div className="inv2-ico"><Avatar name={inv.n || 'S'} url={inv.ic ?? null} size={inv.bn ? 56 : 48} /></div>
                        <div className="inv2-nm"><span className="inv2-nm-t">{inv.n}</span></div>
                        <div className="inv2-stats">
                          <span className="inv2-st"><i className="on" /> {fmtN(inv.o ?? 1)} в сети</span>
                          <span className="inv2-st"><i /> {fmtN(Math.max(inv.m ?? 1, inv.o ?? 1))} {ruMembers(Math.max(inv.m ?? 1, inv.o ?? 1))}</span>
                        </div>
                        {founded && <div className="inv2-meta">Дата основания: {founded} г.</div>}
                        {inv.d && <div className="inv2-desc">{inv.d}</div>}
                        <button className="inv2-join" onClick={() => window.dispatchEvent(new CustomEvent('ponoi-join-invite', { detail: sys.targetId }))}>Перейти на сервер</button>
                      </div>
                    </div>
                  </div>
                )
              })() : sys.type === 'qlaunch' ? (() => {
                // v1.180.0: карточка «Игровой Экспресс» — превью сборки, сам список
                // модов/скачивание/запуск отдельно (см. src/lib/quicklaunch.ts).
                const ql = parseQuickLaunchMeta(sys.preview)
                if (!ql) return null
                return (
                  <div className="inv2-card ql-card">
                    <div className="inv2-lb">{currentUser && m.author === currentUser ? 'Вы поделились сборкой' : m.author_name + ' зовёт тебя в игру!'}</div>
                    <div className="inv2-box ql-box">
                      <div className="ql-ico"><Icon name="gamepad" size={22} /></div>
                      <div className="ql-body">
                        <div className="ql-title">{ql.game} — {ql.mcVersion} ({ql.loader === 'neoforge' ? 'NeoForge' : 'Forge'})</div>
                        <div className="ql-sub">{ql.modCount} {modsWord(ql.modCount)} · {ql.totalMb} МБ докачки</div>
                        <button className="inv2-join ql-btn" onClick={() => {
                          if (!isQuicklaunchAvailable()) { toastErr('Игровой Экспресс работает только в приложении для компьютера'); return }
                          toastOk('Скачивание и авто-вход ещё в разработке — скоро')
                        }}>Скачать и войти</button>
                      </div>
                    </div>
                  </div>
                )
              })() : sys.type === 'call' ? (() => {
                // Системное сообщение о звонке — текст зависит от того, кто смотрит.
                const mineCall = !!currentUser && m.author === currentUser
                const st = sys.targetId
                const dur = parseInt(sys.preview || '0', 10) || 0
                return (
                  <div className={'sys-msg sys-call' + (st === 'missed' && !mineCall ? ' missed' : '')}>
                    <span className="sys-ic"><Icon name={st === 'missed' ? 'phone-off' : 'phone'} size={14} /></span>
                    <span>
                      {st === 'start' && <><b>{m.author_name}</b> начинает звонок.</>}
                      {st === 'ended' && <><b>{m.author_name}</b> начал(а) звонок — он длился {fmtCallDur(dur)}.</>}
                      {st === 'missed' && (mineCall
                        ? <>Никто не ответил на звонок.</>
                        : <>Вы пропустили звонок от <b>{m.author_name}</b>, который длился {fmtCallDur(dur)}.</>)}
                    </span>
                    <span className="msg-time" title={timeFull(m.created_at)}>{msgTime(m.created_at)}</span>
                  </div>
                )
              })() : (
              <div className="sys-msg" title="Перейти к закреплённому сообщению" onClick={() => sys.targetId && jumpToMessage(sys.targetId)}>
                <span className="sys-ic"><Icon name="pin" size={14} /></span>
                <span><b>{m.author_name}</b> закрепил(а) сообщение{sys.preview ? <>: <span className="sys-prev">«{sys.preview}»</span></> : null}</span>
                <span className="msg-time" title={timeFull(m.created_at)}>{msgTime(m.created_at)}</span>
              </div>
              )}
            </Fragment>
          )
        }
        const ts = new Date(m.created_at).getTime()
        const day = new Date(m.created_at).toDateString()
        const showDay = day !== lastDay
        const isReply = !!m.reply_to
        // Replies always show their own header (so the quote reads clearly).
        const grouped = settings.groupMessages && !isReply && !showDay && m.author === lastAuthor && (ts - lastTs) < 7 * 60 * 1000
        lastAuthor = m.author; lastTs = ts; lastDay = day
        const rx = reactions[m.id] ?? []
        const meMentioned = !!(currentUserName && m.content && m.author !== currentUser && mentionsUser(m.content, currentUserName))
        const fwd = parseFwd(m.content)
        const uf: UserFonts = (settings.otherFonts || m.author === currentUser) ? fontsOf(m.author) : {}
        return (
          <Fragment key={m._localId ?? m.id}>
            {newDividerId === m.id && <div className="new-sep"><span>НОВОЕ</span></div>}
            {showDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
            <div id={'msg-' + m.id} className={'msg' + (grouped ? ' grouped' : '') + (m.pinned ? ' pinned' : '') + (meMentioned ? ' mention-hl' : '') + (currentUser && m.author === currentUser ? ' mine' : '') + (editingId === m.id ? ' editing-live' : '')}
              onContextMenu={e => { e.preventDefault(); setPickFor(null); setMenu({ id: m.id, x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 300) }) }}>
              <div className="msg-gutter">
                {grouped
                  ? <span className="msg-ts-hover" title={timeFull(m.created_at)}>{timeShort(m.created_at)}</span>
                  : settings.showAvatars
                  ? <span className="av-click" title="Профиль" onClick={e => onProfile?.(m, Math.min(e.clientX, window.innerWidth - 260), Math.min(e.clientY, window.innerHeight - 340))}><Avatar name={m.author_name} url={m.author_avatar} size={40} userId={m.author} /></span>
                  : null}
              </div>
              <div className="msg-body">
                {isReply && <div className="msg-reply clickable" title="Перейти к сообщению" onClick={() => jumpToMessage(m.reply_to!)}><span className="msg-reply-curve" /> <b>{m.reply_author}</b> <span className="msg-reply-tx">{m.reply_preview}</span></div>}
                {m.pinned && <div className="msg-pinned-tag"><Icon name="pin" size={13} /> Закреплено</div>}
                {!grouped && <div className="msg-hdr"><span className={'nm' + (onProfile ? ' clickable' : '')} style={{ color: colorOf?.(m.author), fontFamily: uf.nick }} onClick={e => onProfile?.(m, Math.min(e.clientX, window.innerWidth - 260), Math.min(e.clientY, window.innerHeight - 340))}>{m.author_name}</span>{(() => { const ic = iconOf?.(m.author); return ic ? <img className="role-badge" src={ic} alt="" /> : null })()}<UserTagBadge userId={m.author} />{ownerId != null && m.author === ownerId && <span className="msg-crown" title="Владелец сервера"><Icon name="crown" size={13} /></span>}<span className="msg-time" title={timeFull(m.created_at)}>{msgTime(m.created_at)}</span>{m.edited && <span className="msg-edited" title="Сообщение было отредактировано">(изменено)</span>}</div>}
                {fwd
                  ? <div className="msg-fwd">
                      <div className="msg-fwd-hdr"><Icon name="forward" size={13} /> Пересланное сообщение</div>
                      {fwd.text && <div className="msg-txt">{renderContent(fwd.text)}</div>}
                      <div className="msg-fwd-src">от <b>{fwd.author}</b>{fwd.at ? ' • ' + timeFull(fwd.at) : ''}</div>
                    </div>
                  : m.content && !isOnlyGifLink(m) && <div className={'msg-txt' + (settings.bigEmoji && isEmojiOnly(m.content) ? ' big-emoji' : '')} style={{ fontFamily: uf.msg }}>{renderContent(m.content)}{m.edited && grouped && <span className="msg-edited" title="Сообщение было отредактировано">(изменено)</span>}</div>}
                <Attachment url={m.attach_url} type={m.attach_type} meta={{ name: m.author_name, avatar: m.author_avatar, at: m.created_at }}
                  editable={m.author === currentUser} attachMeta={m.attach_meta}
                  onEditAttachment={onEditAttachment ? (i, patch) => onEditAttachment(m.id, i, patch) : undefined} />
                {!m.attach_url && findGifLink(m.content) && <GifEmbed url={findGifLink(m.content)!} meta={{ name: m.author_name, avatar: m.author_avatar, at: m.created_at }} />}
                {!m.attach_url && !findGifLink(m.content) && findYouTubeLink(m.content) && <YouTubeEmbed url={findYouTubeLink(m.content)!} />}
                <span className="tg-time" title={timeFull(m.created_at)}>{timeShort(m.created_at)}</span>
                {rx.length > 0 && <div className="rx-bar">
                  {rx.map(r => {
                    const mine = currentUser ? r.users.includes(currentUser) : false
                    return <button key={r.emoji} className={'rx' + (mine ? ' mine' : '')} onClick={() => onReact?.(m.id, r.emoji)}>
                      <span><RxEmoji e={r.emoji} /></span><span className="rx-n">{r.count}</span>
                      <span className="rx-tip"><span className="rx-tip-e"><RxEmoji e={r.emoji} /></span>{rxWho(r.users, currentUser, nameOf, currentUserName)}</span>
                    </button>
                  })}
                  <button className="rx rx-add" title="Добавить реакцию" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}><Icon name="plus" size={14} /></button>
                  {pickFor === m.id && <div className="rx-quick">
                    {QUICK.map(e => <button key={e} onClick={() => { onReact?.(m.id, e); setPickFor(null) }}><Em>{e}</Em></button>)}
                  </div>}
                </div>}
              </div>
              <div className="msg-tools">
                {onReply && <button title="Ответить" onClick={() => onReply(m)}><Icon name="reply" size={18} /></button>}
                {currentUser && <button title="Переслать" onClick={() => setFwdFor(m)}><Icon name="forward" size={18} /></button>}
                <button title="Реакция" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}><Icon name="smile" size={18} /></button>
                {rx.length === 0 && pickFor === m.id && <div className="rx-quick tools-quick">
                  {QUICK.map(e => <button key={e} onClick={() => { onReact?.(m.id, e); setPickFor(null) }}><Em>{e}</Em></button>)}
                </div>}
                {m.author === currentUser && onStartEdit && m.content && !fwd && <button title="Изменить" onClick={() => onStartEdit(m)}><Icon name="edit" size={18} /></button>}
                <button title="Ещё" onClick={e => { setPickFor(null); setMenu({ id: m.id, x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 300) }) }}><Icon name="more" size={18} /></button>
              </div>
            </div>
          </Fragment>
        )
      })}

      {menu && menuMsg && (() => {
        const img = msgImage(menuMsg)
        // v1.105.0: правый клик по гифке — пункты меню про гифку, а не про изображение.
        const isGif = !!img && /\.gif(?:$|\?)/i.test(img.split('#')[0])
        const fwdM = parseFwd(menuMsg.content)
        const textOf = fwdM ? fwdM.text : (menuMsg.content ?? '')
        const item = (label: string, icon: string, fn: () => void, cls = '') => (
          <div className={'ctx-item' + cls} onClick={() => { fn(); setMenu(null) }}><span>{label}</span><Icon name={icon} size={16} /></div>
        )
        return <>
        <div className="ctx-overlay" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }} />
        <div className="ctx-menu" style={{ left: Math.min(menu.x, window.innerWidth - 250), top: Math.max(8, Math.min(menu.y, window.innerHeight - (img ? 560 : 440))) }}>
          <div className="ctx-quick">
            {QUICK.slice(0, 4).map(e => <button key={e} onClick={() => { onReact?.(menu.id, e); setMenu(null) }}><Em>{e}</Em></button>)}
          </div>
          <div className="ctx-item" onClick={() => { setEmojiAt({ id: menu.id, x: menu.x, y: menu.y }); setMenu(null) }}><span>Добавить реакцию</span><Icon name="chevron-right" size={16} /></div>
          <div className="ctx-sep" />
          {menuMsg.author === currentUser && onStartEdit && menuMsg.content && !fwdM ? item('Редактировать', 'edit', () => onStartEdit(menuMsg)) : null}
          {onReply ? item('Ответить', 'reply', () => onReply(menuMsg)) : null}
          {currentUser ? item('Переслать', 'forward', () => setFwdFor(menuMsg)) : null}
          <div className="ctx-sep" />
          {textOf ? item('Скопировать текст', 'copy', () => { copyText(textOf, 'Текст скопирован') }) : null}
          {(canPin ? canPin(menuMsg) : true) ? item(menuMsg.pinned ? 'Открепить сообщение' : 'Закрепить сообщение', 'pin', () => onPin?.(menu.id, !menuMsg.pinned)) : null}
          {onMarkUnread ? item('Отметить как непрочитанное', 'message', () => { onMarkUnread(menuMsg); toastOk('Отмечено как непрочитанное') }) : null}
          {item('Скопировать ссылку на сообщение', 'link', () => { copyText(linkCtx ? buildMsgLink(linkCtx, menuMsg.id) : 'ponoi://msg/' + menuMsg.id, 'Ссылка скопирована') })}
          {textOf ? item('Зачитать сообщение', 'volume', () => speakMsg(menuMsg)) : null}
          {img ? <>
            <div className="ctx-sep" />
            {isGif ? item('Скопировать гифку', 'image', () => { copyGif(img) })
                   : item('Копировать изображение', 'image', () => { copyMedia(img) })}
            {item(isGif ? 'Сохранить гифку' : 'Сохранить изображение', 'download', () => { saveMedia(img) })}
            <div className="ctx-sep" />
            {item(isGif ? 'Копировать ссылку на гифку' : 'Копировать ссылку на изображение', 'link', () => { copyText(img, 'Ссылка скопирована') })}
            {item(isGif ? 'Открыть ссылку на гифку' : 'Открыть ссылку на изображение', 'external', () => { window.open(img, '_blank') })}
          </> : null}
          {(canDelete ? canDelete(menuMsg) : menuMsg.author === currentUser) ? <>
            <div className="ctx-sep" />
            {item('Удалить сообщение', 'trash', () => onDelete?.(menu.id), ' danger')}
          </> : null}
          <div className="ctx-sep" />
          {item('Копировать ID сообщения', 'id-card', () => { copyText(menuMsg.id, 'ID скопирован') })}
        </div>
        </>
      })()}

      {emojiAt && <>
        <div className="ctx-overlay" onClick={() => setEmojiAt(null)} />
        <div className="ctx-emoji-pop" style={{ left: Math.min(emojiAt.x, window.innerWidth - 380), top: Math.max(8, Math.min(emojiAt.y, window.innerHeight - 470)) }} onClick={e => e.stopPropagation()}>
          <EmojiPicker onPick={e => { onReact?.(emojiAt.id, e); setEmojiAt(null) }} onClose={() => setEmojiAt(null)} />
        </div>
      </>}

      {fwdFor && currentUser && <ForwardModal src={fwdFor} meId={currentUser} meName={currentUserName ?? (localStorage.getItem('ponoi_username') || '?')} onClose={() => setFwdFor(null)} />}
    </>
  )
}