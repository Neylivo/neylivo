import { Fragment, useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { Attachment } from './Composer'
import { timeShort, timeFull, dayLabel, msgTime, callTime, fmtN, ruMembers } from '../lib/ui'
import { renderMd } from '../lib/md'
import { mentionsMe, mentionsMyRole, type MentionRights } from '../lib/mentions'
import type { RxSummary } from '../lib/reactions'
import { Icon } from './icons'
import { useSettings, devMode } from '../lib/settings'
import { isLongText } from '../lib/longText'
import { useUserFonts, type UserFonts } from '../lib/userFonts'
import { toastOk, toastErr } from '../lib/toast'
import { parseSys, fmtCallDur, parseInviteMeta, parseQuickLaunchMeta, parseGameLinkMeta, type SysMsg } from '../lib/sysmsg'
import { openGameLink, terrariaLaunch, steamConnectUrl } from '../lib/gameShare'
import { useMessageActions, useContextItems } from '../lib/plugins/registry'
import { invokePlugin, emitPluginEvent } from '../lib/plugins/host'
import { renderedContent, subscribeRendered, hasInterceptors } from '../lib/plugins/middleware'
import { setChatBridge } from '../lib/plugins/chatApi'
import { useBackClose } from '../lib/mobileBack'
import { QuickLaunchCard } from './QuickLaunchCard'
import { copyMedia, copyGif, saveMedia, copyText } from '../lib/copyMedia'
import { findGifLink, resolveGif, cachedGif } from '../lib/gifUrl'
import { buildMsgLink, type MsgLinkCtx } from '../lib/deepLink'
import { findYouTubeLink, ytMeta } from '../music/sources'
import type { ScMeta } from '../music/soundcloud'
import { guardLink } from '../lib/linkguard'
import { useClampToViewport } from '../lib/clampPos'

// v1.180.0: «1 мод / 2 мода / 5 модов» — для карточки «Игровой Экспресс».
function modsWord(n: number): string {
  const d = n % 100
  if (d >= 11 && d <= 14) return 'модов'
  const r = n % 10
  return r === 1 ? 'мод' : r >= 2 && r <= 4 ? 'мода' : 'модов'
}
import { parseFwd } from '../lib/fwd'

// v1.285.0: карточки «Поделиться игрой» (и qlaunch, и glink) гаснут через час
// после отправки — чтобы старые ссылки не продолжали дёргать fetchPack()/сеть
// у всех, кто листает историю, и не звали в давно закрытую игру.
const SHARE_TTL_MS = 60 * 60 * 1000
function useShareExpired(createdAt: string): boolean {
  const [expired, setExpired] = useState(() => Date.now() - new Date(createdAt).getTime() > SHARE_TTL_MS)
  useEffect(() => {
    if (expired) return
    const left = SHARE_TTL_MS - (Date.now() - new Date(createdAt).getTime())
    const t = setTimeout(() => setExpired(true), Math.max(0, left))
    return () => clearTimeout(t)
  }, [createdAt, expired])
  return expired
}
function ShareEndedCard({ label }: { label: string }) {
  return (
    <div className="inv2-card ql-card">
      <div className="inv2-lb">{label}</div>
      <div className="inv2-box ql-box ql-ended">
        <div className="ql-ico"><Icon name="gamepad" size={22} /></div>
        <div className="ql-body">
          <div className="ql-title">Игровой обмен завершён</div>
          <div className="ql-sub">Ссылка на подключение больше не активна</div>
        </div>
      </div>
    </div>
  )
}

function QlaunchShareCard({ sys, createdAt, label, currentUserName }: { sys: SysMsg; createdAt: string; label: string; currentUserName?: string | null }) {
  const expired = useShareExpired(createdAt)
  const ql = parseQuickLaunchMeta(sys.preview)
  if (!ql) return null
  if (expired) return <ShareEndedCard label={label} />
  const loaderLabel = ql.loader === 'neoforge' ? 'NeoForge' : ql.loader === 'fabric' ? 'Fabric' : ql.loader === 'forge' ? 'Forge' : null
  return (
    <div className="inv2-card ql-card">
      <div className="inv2-lb">{label}</div>
      <div className={'inv2-box ql-box' + (ql.cardBg ? ' has-custom-bg' : '')} style={ql.cardBg ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)), url(${ql.cardBg})` } : undefined}>
        <div className="ql-ico"><Icon name="gamepad" size={22} /></div>
        <div className="ql-body">
          <div className="ql-title">{ql.cardTitle || `${ql.game} — ${ql.mcVersion}${loaderLabel ? ` (${loaderLabel})` : ''}`}</div>
          <div className="ql-sub">{ql.cardSubtitle || `${ql.modCount} ${modsWord(ql.modCount)} · ${ql.totalMb} МБ докачки`}</div>
          <QuickLaunchCard packId={sys.targetId} username={currentUserName || 'Player'} />
        </div>
      </div>
    </div>
  )
}

function GlinkShareCard({ sys, createdAt, label }: { sys: SysMsg; createdAt: string; label: string }) {
  const expired = useShareExpired(createdAt)
  const gl = parseGameLinkMeta(sys.preview)
  if (!gl) return null
  if (expired) return <ShareEndedCard label={label} />
  const HOST_RE = /^[A-Za-z0-9.\-]{1,255}$/
  const join = async () => {
    if (sys.targetId === 'terraria' && gl.ip) {
      try { await terrariaLaunch(gl.ip, gl.port ?? 0) }
      catch (err: any) { toastErr(err.message ?? String(err)) }
    } else if (sys.targetId === 'cs2') {
      const port = gl.port ?? 0
      if (!gl.ip || !HOST_RE.test(gl.ip) || port < 1 || port > 65535) { toastErr('Некорректный адрес сервера'); return }
      openGameLink(steamConnectUrl(gl.ip, port))
    } else if (gl.url) openGameLink(gl.url)
  }
  return (
    <div className="inv2-card ql-card">
      <div className="inv2-lb">{label}</div>
      <div className={'inv2-box ql-box' + (gl.cardBg ? ' has-custom-bg' : '')} style={gl.cardBg ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)), url(${gl.cardBg})` } : undefined}>
        <div className="ql-ico"><Icon name="gamepad" size={22} /></div>
        <div className="ql-body">
          <div className="ql-title">{gl.cardTitle || gl.game}</div>
          {(gl.cardSubtitle || gl.label) && <div className="ql-sub">{gl.cardSubtitle || gl.label}</div>}
          <button className="inv2-join ql-btn" onClick={join}>Присоединиться</button>
        </div>
      </div>
    </div>
  )
}
import { ForwardModal } from './ForwardModal'
import { EmojiPicker } from './EmojiPicker'
import { UserTagBadge } from './TagEmoji'
import { isBotUser } from '../lib/botTag'

// v1.193.0: бейдж «БОТ» у имени в чате — самодостаточный резолвер по userId,
// тот же приём, что UserTagBadge (TagEmoji.tsx), но источник — profiles.is_bot.
function BotBadge({ userId }: { userId: string }) {
  const [isBot, setIsBot] = useState(false)
  useEffect(() => { let ok = true; isBotUser(userId).then(v => { if (ok) setIsBot(v) }); return () => { ok = false } }, [userId])
  if (!isBot) return null
  return <span className="bot-badge" title="Бот">БОТ</span>
}

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
import { openSafely } from '../lib/safeUrl'
import { startLongPress } from '../lib/longPress'

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
function renderContent(text: string, roleColors?: Record<string, string>) {
  return renderMd(text, roleColors)
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
  // v1.198.0: право ADD_REACTIONS — undefined (ЛС) значит «можно», false прячет все кнопки добавления реакции.
  canReact?: boolean
  onPin?: (id: string, pinned: boolean) => void
  // v1.352.0: второй довод — «не спрашивать». Он приходит от Shift, как в Discord:
  // тем, кто чистит чат пачкой, подтверждение на каждое сообщение только мешает.
  onDelete?: (id: string, skipConfirm?: boolean) => void
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
  // v1.239.0: цвета ролей сервера (имя роли в нижнем регистре -> цвет) — чтобы
  // @Роль в тексте сообщения красилась как настоящая роль (см. src/lib/md.tsx).
  roleColors?: Record<string, string>
  // v1.445.0: режим выбора нескольких сообщений (удаление пачкой).
  // Набор и его разбор живут у родителя: он же удаляет и он же считает, что
  // именно удалится (src/lib/bulkSelect.ts). Здесь только показ и нажатия.
  selectMode?: boolean
  selected?: ReadonlySet<string>
  /** Нажали по сообщению в режиме выбора. shift — брать диапазон. */
  onSelectToggle?: (id: string, shift: boolean) => void
  /** «Выбрать сообщения» из меню — включает режим и отмечает это сообщение. */
  onSelectStart?: (id: string) => void
  // v1.239.0: мои роли на этом сервере — упоминание любой из них подсвечивает
  // сообщение так же, как упоминание меня лично.
  myRoleNames?: string[]
  // v1.449.0: что автору сообщения ПОЗВОЛЕНО упоминать. Решает получатель:
  // право на @everyone проверялось только в поле ввода у отправителя, и
  // обходилось своим клиентом, ботом или плагином (см. lib/mentions.ts).
  mentionRights?: (userId: string) => MentionRights | undefined
}

export function MessageList({ messages, reactions = {}, currentUser, currentUserName, canPin, canDelete, onReact, canReact, onPin, onDelete, onReply, onStartEdit, editingId, onEditAttachment, onProfile, newDividerId, ownerId, nameOf, colorOf, iconOf, onMarkUnread, linkCtx, roleColors, myRoleNames, mentionRights, selectMode, selected, onSelectToggle, onSelectStart }: Props) {
  const { settings } = useSettings()
  // v1.112.0: шрифты авторов (ник + сообщения) — видны всем; чужие отключаются настройкой.
  const fontsOf = useUserFonts(messages.map(m => m.author))
  // v1.465.0: в меню запоминается и выделенный текст. Спрашивать getSelection в
  // момент отрисовки пунктов поздно: щелчок по пункту сбивает выделение, и
  // плагин получил бы пустоту вместо того, что человек выделил.
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; sel?: string } | null>(null)
  // v1.187.0: сообщения от игнорируемых (ЛС, см. DmCtxMenu.tsx) свёрнуты, пока не раскроют вручную.
  const [revealedIgnored, setRevealedIgnored] = useState<Set<string>>(new Set())
  const [pickFor, setPickFor] = useState<string | null>(null)
  const [fwdFor, setFwdFor] = useState<UiMessage | null>(null)
  // Развёрнутые сообщения помним по id: свернуть обратно можно тем же нажатием,
  // а при обновлении ленты выбор не теряется.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [emojiAt, setEmojiAt] = useState<{ id: string; x: number; y: number } | null>(null)
  const [, setEmojiVer] = useState(0)
  // v1.286.0: пункты меню сообщения, добавленные плагинами (см. lib/plugins/registry).
  const pluginActions = useMessageActions()
  // v1.465.0: перехватчик показа. Ответ приходит из воркера асинхронно, поэтому
  // первый раз рисуется исходный текст, а посчитанное приезжает следом и
  // перерисовывает — иначе пришлось бы ждать чужой код на каждой перерисовке
  // при прокрутке.
  const [, setRenderVer] = useState(0)
  useEffect(() => subscribeRendered(() => setRenderVer(v => v + 1)), [])
  const shown = (m: UiMessage): string => {
    const c = m.content ?? ''
    if (!c || !hasInterceptors('render')) return c
    return renderedContent(
      { id: m.id, content: c, author: m.author, mine: m.author === currentUser },
      (pid, fn, a) => invokePlugin(pid, fn, a),
    )
  }
  const pluginCtx = useContextItems('message')
  const pluginSel = useContextItems('selection')
  /** Что человек выделил прямо сейчас. Пусто — выделения нет. */
  const selNow = () => {
    try { return (window.getSelection?.()?.toString() ?? '').trim().slice(0, 8000) } catch { return '' }
  }

  // v1.286.0: событие 'message' для плагинов, подписавшихся с разрешением
  // messages.read. Два фильтра сразу: id не должен быть уже виденным (перерисовки,
  // подгрузка истории) И сообщение должно быть свежим — иначе при каждом
  // переключении канала плагину прилетала бы вся его переписка как «новая».
  // v1.427.0: «назад» на телефоне закрывает меню сообщения. Оно теперь
  // открывается долгим нажатием, то есть встречается там постоянно.
  useBackClose(!!menu, () => setMenu(null))

  const seenMsgIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const m of messages) {
      if (seenMsgIds.current.has(m.id)) continue
      seenMsgIds.current.add(m.id)
      const age = Date.now() - new Date(m.created_at).getTime()
      if (age >= 0 && age < 30_000) {
        // v1.333.0: mentionsMe и имя автора — плагину иначе неоткуда узнать, что
        // обратились именно к тебе: своего ника он не знает и знать не должен.
        // Своё же сообщение событием не считаем — плагин-автоответчик отвечал бы
        // сам себе.
        emitPluginEvent('message', {
          id: m.id, author: m.author, authorName: m.author_name, content: m.content ?? '',
          mine: m.author === currentUser,
          mentionsMe: !!currentUserName && !!m.content && m.author !== currentUser && mentionsMe(m.content, currentUserName, mentionRights?.(m.author)),
        })
      }
    }
    // Множество виденного не должно расти бесконечно за долгую сессию.
    if (seenMsgIds.current.size > 5000) seenMsgIds.current = new Set(messages.map(m => m.id))
  }, [messages])

  // v1.419.0: мост для плагинов — прочитать то, что уже на экране, поставить
  // реакцию и убрать своё сообщение.
  //
  // Здесь, а не в api.ts, потому что и реакция, и удаление идут теми же
  // обработчиками, что и нажатие мышью: со всеми проверками прав канала,
  // подтверждениями и откатами. Плагин ничего не делает с базой сам.
  //
  // Ключ — id открытого разговора (канал или диалог), тот же, который плагин
  // получает в ponoi.channel(). Полей ввода и лент на экране до трёх сразу
  // (канал, личка, ветка): без ключа плагин читал бы ту, что отрисовалась
  // последней, а не ту, которую человек видит.
  const chatKey = linkCtx ? (linkCtx.kind === 'server' ? linkCtx.channelId : linkCtx.dmId) : null
  const bridgeRef = useRef({ messages, currentUser, canDelete, onReact, onDelete, canReact })
  bridgeRef.current = { messages, currentUser, canDelete, onReact, onDelete, canReact }
  useEffect(() => {
    if (!chatKey) return
    setChatBridge(chatKey, {
      recent: (limit: number) => {
        const b = bridgeRef.current
        return b.messages.slice(-limit).map(m => ({
          id: m.id, author: m.author, authorName: m.author_name ?? '',
          content: m.content ?? '', mine: m.author === b.currentUser,
          at: m.created_at,
        }))
      },
      react: async (messageId: string, emoji: string) => {
        const b = bridgeRef.current
        if (b.canReact === false) return 'В этом канале нельзя ставить реакции.'
        if (!b.onReact) return 'В этом чате реакции недоступны.'
        if (!b.messages.some(m => m.id === messageId)) return 'Такого сообщения нет среди открытых.'
        b.onReact(messageId, emoji)
        return null
      },
      remove: async (messageId: string) => {
        const b = bridgeRef.current
        const m = b.messages.find(x => x.id === messageId)
        if (!m) return 'Такого сообщения нет среди открытых.'
        // Чужое не трогаем даже у модератора: право «Управление сообщениями»
        // даётся человеку, а не плагину, который он поставил из чата.
        if (m.author !== b.currentUser) return 'Плагин может убрать только твоё сообщение.'
        if (!b.onDelete) return 'В этом чате удаление недоступно.'
        b.onDelete(messageId, true)
        return null
      },
    })
    return () => setChatBridge(chatKey, null)
  }, [chatKey])

  // v1.397.0: правка и удаление сообщения — тоже события. Раньше плагин узнавал
  // только о новых: автопереводчик переводил сообщение и не замечал, что его
  // тут же поправили, а модерации нечего было ловить.
  //
  // Осторожно со сменой канала: там список заменяется целиком, и если считать
  // «пропал из списка» удалением, при каждом переходе плагину прилетала бы
  // «удалена» вся прошлая переписка. Поэтому сверяем списки только когда это
  // один и тот же разговор — хоть одно сообщение осталось на месте.
  const prevMsgs = useRef<Map<string, { content: string; author: string }>>(new Map())
  useEffect(() => {
    const now = new Map<string, { content: string; author: string }>()
    for (const m of messages) now.set(m.id, { content: m.content ?? '', author: m.author })
    const prev = prevMsgs.current
    const sameThread = prev.size > 0 && [...now.keys()].some(id => prev.has(id))
    if (sameThread) {
      for (const [id, cur] of now) {
        const before = prev.get(id)
        if (before && before.content !== cur.content) {
          emitPluginEvent('message.edit', { id, author: cur.author, content: cur.content })
        }
      }
      for (const id of prev.keys()) {
        if (!now.has(id)) emitPluginEvent('message.delete', { id })
      }
    }
    prevMsgs.current = now
  }, [messages])

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
  // v1.225.0: реальный размер панельки меняется от сообщения к сообщению (разное
  // число пунктов меню) — клампим по факту, а не по прикидке (см. src/lib/clampPos.ts).
  const menuClamp = useClampToViewport(menu?.x ?? 0, menu?.y ?? 0)
  const emojiClamp = useClampToViewport(emojiAt?.x ?? 0, emojiAt?.y ?? 0)

  return (
    <>
      <StickyDatePill />
      {messages.map(m => {
        // v1.187.0: сообщение от игнорируемого пользователя (ЛС) — свёрнуто, пока не раскроют.
        if ((m as any)._ignoredAuthor && !revealedIgnored.has(m.id)) {
          const iDay = new Date(m.created_at).toDateString()
          const showIDay = iDay !== lastDay
          lastDay = iDay
          lastAuthor = ''
          return (
            <Fragment key={m._localId ?? m.id}>
              {showIDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
              <div className="sys-msg ignored-msg" onClick={() => setRevealedIgnored(s => new Set(s).add(m.id))}>
                <span className="sys-ic"><Icon name="flag" size={14} /></span>
                <span>Сообщение от игнорируемого пользователя — нажмите, чтобы показать</span>
              </div>
            </Fragment>
          )
        }
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
              })() : sys.type === 'qlaunch' ? (
                // v1.180.0: карточка «Игровой Экспресс» — превью сборки, сам список
                // модов/скачивание/запуск отдельно (см. src/lib/quicklaunch.ts).
                // v1.285.0: гаснет через час — см. QlaunchShareCard/useShareExpired выше.
                <QlaunchShareCard sys={sys} createdAt={m.created_at}
                  label={currentUser && m.author === currentUser ? 'Вы поделились сборкой' : m.author_name + ' зовёт тебя в игру!'}
                  currentUserName={currentUserName} />
              ) : sys.type === 'glink' ? (
                // v1.184.0: «Поделиться игрой» для игр без установки/скачивания —
                // v1.192.0: Roblox/CS2 просто открывают диплинк-ссылку (см.
                // src/lib/gameShare.ts), Terraria своего протокола не имеет — жмём
                // на месте запускаем Terraria.exe через IPC (terrariaLaunch).
                // v1.285.0: гаснет через час — см. GlinkShareCard/useShareExpired выше.
                <GlinkShareCard sys={sys} createdAt={m.created_at}
                  label={currentUser && m.author === currentUser ? 'Вы поделились игрой' : m.author_name + ' зовёт тебя в игру!'} />
              ) : sys.type === 'join' ? (
                // v1.329.0: «X присоединился к серверу» — пишет сама база при
                // вступлении (supabase/86_join_messages.sql), поэтому строчка
                // появляется и когда человек вошёл с другого устройства.
                <div className="sys-msg sys-join">
                  <span className="sys-ic"><Icon name="user-plus" size={16} /></span>
                  <span><b>{m.author_name}</b> присоединил(ась)ся к серверу. Встречайте!</span>
                  <span className="msg-time" title={timeFull(m.created_at)}>{msgTime(m.created_at)}</span>
                </div>
              ) : sys.type === 'call' ? (() => {
                // Системное сообщение о звонке — текст зависит от того, кто смотрит.
                const mineCall = !!currentUser && m.author === currentUser
                const st = sys.targetId
                const dur = parseInt(sys.preview || '0', 10) || 0
                // v1.197.0: иконки как в Discord — стрелка вверх-вправо, зелёная (звонок
                // состоялся), стрелка вниз-вправо, серая (не удался) — для ОБЕИХ сторон
                // пропущенного звонка одинаково, раньше серым видел только тот, кому не
                // дозвонились, у самого звонящего иконка оставалась зелёной.
                const icon = st === 'missed' ? 'phone-down' : st === 'ended' ? 'phone-up' : 'phone'
                return (
                  <div className={'sys-msg sys-call' + (st === 'missed' ? ' missed' : '')}>
                    <span className="sys-ic"><Icon name={icon} size={16} /></span>
                    <span>
                      {st === 'start' && <><b>{m.author_name}</b> начинает звонок.</>}
                      {st === 'ended' && <><b>{m.author_name}</b> начал(а) звонок продолжительностью {fmtCallDur(dur)}.</>}
                      {st === 'missed' && (mineCall
                        ? <>Никто не ответил на звонок.</>
                        : <>Вы пропустили звонок от <b>{m.author_name}</b>, который длился {fmtCallDur(dur)}.</>)}
                    </span>
                    <span className="msg-time" title={timeFull(m.created_at)}>{callTime(m.created_at)}</span>
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
        const meMentioned = !!(currentUserName && m.content && m.author !== currentUser
          && (() => {
            const rights = mentionRights?.(m.author)
            return mentionsMe(m.content!, currentUserName, rights)
              || myRoleNames?.some(rn => mentionsMyRole(m.content!, rn, rights))
          })())
        const fwd = parseFwd(m.content)
        const uf: UserFonts = (settings.otherFonts || m.author === currentUser) ? fontsOf(m.author) : {}
        return (
          <Fragment key={m._localId ?? m.id}>
            {newDividerId === m.id && <div className="new-sep"><span>НОВОЕ</span></div>}
            {showDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
            <div id={'msg-' + m.id} className={'msg' + (grouped ? ' grouped' : '') + (m.pinned ? ' pinned' : '') + (meMentioned ? ' mention-hl' : '') + (currentUser && m.author === currentUser ? ' mine' : '') + (editingId === m.id ? ' editing-live' : '') + (selectMode ? ' picking' : '') + (selected?.has(m.id) ? ' picked' : '')}
              /* v1.445.0: в режиме выбора нажатие по строке отмечает её, а не
                 открывает что-либо. Меню, ответ двойным щелчком и долгое
                 нажатие на это время выключены: иначе уборка превращалась бы в
                 случайные ответы и открытые окна. */
              onClickCapture={selectMode ? (e => {
                const t = e.target as HTMLElement
                // Ссылку и картинку по-прежнему можно открыть: человек может
                // захотеть посмотреть, что именно он удаляет.
                if (t.closest('a, img, video')) return
                e.preventDefault(); e.stopPropagation()
                onSelectToggle?.(m.id, e.shiftKey)
              }) : undefined}
              onContextMenu={e => { e.preventDefault(); if (selectMode) return; setPickFor(null); setMenu({ id: m.id, x: e.clientX, y: e.clientY, sel: selNow() }) }}
              /* v1.426.0: долгое нажатие открывает то же меню сообщения.
                 На телефоне меню не открывалось НИЧЕМ: правого щелчка там нет, а
                 долгое нажатие браузер отдаёт выделению текста и события
                 contextmenu не присылает. То есть ответить, закрепить, скопировать
                 ссылку, переслать и удалить сообщение с телефона было нельзя
                 вообще — всё это жило в меню, до которого не добраться. */
              /* v1.433.0: отсчёт общий (lib/longPress.ts). Здесь он отменялся
                 на первом же pointermove — то есть на дрожи руки, которая идёт
                 постоянно: меню на телефоне почти не открывалось. */
              onPointerDown={e => { if (selectMode) return; startLongPress(e, at => { setPickFor(null); setMenu({ id: m.id, ...at, sel: selNow() }) }) }}
              onDoubleClick={e => {
                // v1.352.0: двойной щелчок — ответить, как в Telegram. Выделение текста
                // двойным щелчком при этом не ломается: если что-то выделилось, человек
                // копирует, а не отвечает, и мы не мешаем.
                if (!onReply || selectMode) return
                if (window.getSelection()?.toString()) return
                const t = e.target as HTMLElement
                // Внутри ссылок, кнопок, полей и картинок двойной щелчок значит своё.
                if (t.closest('a, button, input, textarea, img, video, .msg-reply, .msg-react')) return
                onReply(m)
              }}>
              <div className="msg-gutter">
                {/* v1.445.0: галочка на месте аватарки — так строка не прыгает
                    при входе в режим выбора и обратно. */}
                {selectMode
                  ? <span className={'msg-pick' + (selected?.has(m.id) ? ' on' : '')} aria-hidden>
                      {selected?.has(m.id) ? <Icon name="check" size={13} /> : null}
                    </span>
                  : grouped
                  ? <span className="msg-ts-hover" title={timeFull(m.created_at)}>{timeShort(m.created_at)}</span>
                  : settings.showAvatars
                  ? <span className="av-click" title="Профиль" onClick={e => onProfile?.(m, Math.min(e.clientX, window.innerWidth - 260), Math.min(e.clientY, window.innerHeight - 340))}><Avatar name={m.author_name} url={m.author_avatar} size={40} userId={m.author} /></span>
                  : null}
              </div>
              <div className="msg-body">
                {isReply && <div className="msg-reply clickable" title="Перейти к сообщению" onClick={() => jumpToMessage(m.reply_to!)}><span className="msg-reply-curve" /> <b>{m.reply_author}</b> <span className="msg-reply-tx">{m.reply_preview}</span></div>}
                {m.pinned && <div className="msg-pinned-tag"><Icon name="pin" size={13} /> Закреплено</div>}
                {!grouped && <div className="msg-hdr"><span className={'nm' + (onProfile ? ' clickable' : '')} style={{ color: colorOf?.(m.author), fontFamily: uf.nick }} onClick={e => onProfile?.(m, Math.min(e.clientX, window.innerWidth - 260), Math.min(e.clientY, window.innerHeight - 340))}>{m.author_name}</span>{(() => { const ic = iconOf?.(m.author); return ic ? <img className="role-badge" src={ic} alt="" /> : null })()}<BotBadge userId={m.author} /><UserTagBadge userId={m.author} />{ownerId != null && m.author === ownerId && <span className="msg-crown" title="Владелец сервера"><Icon name="crown" size={13} /></span>}<span className="msg-time" title={timeFull(m.created_at)}>{msgTime(m.created_at)}</span>{m.edited && <span className="msg-edited" title={(m as any).edited_at ? 'Отредактировано ' + timeFull((m as any).edited_at) : 'Сообщение было отредактировано'}><Icon name="edit" size={11} /></span>}</div>}
                {fwd
                  ? <div className="msg-fwd">
                      <div className="msg-fwd-hdr"><Icon name="forward" size={13} /> Пересланное сообщение</div>
                      {fwd.text && <div className="msg-txt">{renderContent(fwd.text, roleColors)}</div>}
                      <div className="msg-fwd-src">от <b>{fwd.author}</b>{fwd.at ? ' • ' + timeFull(fwd.at) : ''}</div>
                    </div>
                  : (m as any)._dec ? <div className="msg-dec" title="Расшифровывается"><i /><i /><i /></div>
                  : m.content && !isOnlyGifLink(m) && (() => {
                    const long = isLongText(m.content)
                    const open = !!expanded[m.id]
                    return <>
                      <div className={'msg-txt' + (settings.bigEmoji && isEmojiOnly(m.content) ? ' big-emoji' : '') + (long && !open ? ' msg-clamp' : '')} style={{ fontFamily: uf.msg }}>{renderContent(shown(m), roleColors)}{m.edited && grouped && <span className="msg-edited" title={(m as any).edited_at ? 'Отредактировано ' + timeFull((m as any).edited_at) : 'Сообщение было отредактировано'}><Icon name="edit" size={11} /></span>}</div>
                      {long && <button className="msg-more" onClick={() => setExpanded(e => ({ ...e, [m.id]: !e[m.id] }))}>
                        {open ? 'Свернуть' : 'Показать полностью'}
                      </button>}
                    </>
                  })()}
                <Attachment url={m.attach_url} type={m.attach_type} meta={{ name: m.author_name, avatar: m.author_avatar, at: m.created_at }}
                  editable={m.author === currentUser} attachMeta={m.attach_meta}
                  uploading={(m as any)._uploading} progress={(m as any)._upProgress} pendingNames={(m as any)._uploadNames}
                  onEditAttachment={onEditAttachment ? (i, patch) => onEditAttachment(m.id, i, patch) : undefined} />
                {!m.attach_url && findGifLink(m.content) && <GifEmbed url={findGifLink(m.content)!} meta={{ name: m.author_name, avatar: m.author_avatar, at: m.created_at }} />}
                {!m.attach_url && !findGifLink(m.content) && findYouTubeLink(m.content) && <YouTubeEmbed url={findYouTubeLink(m.content)!} />}
                <span className="tg-time" title={timeFull(m.created_at)}>{timeShort(m.created_at)}</span>
                {rx.length > 0 && <div className="rx-bar">
                  {rx.map(r => {
                    const mine = currentUser ? r.users.includes(currentUser) : false
                    return <button key={r.emoji} className={'rx' + (mine ? ' mine' : '')} disabled={canReact === false}
                      onClick={() => canReact !== false && onReact?.(m.id, r.emoji)}>
                      <span><RxEmoji e={r.emoji} /></span><span className="rx-n">{r.count}</span>
                      <span className="rx-tip"><span className="rx-tip-e"><RxEmoji e={r.emoji} /></span>{rxWho(r.users, currentUser, nameOf, currentUserName)}</span>
                    </button>
                  })}
                  {canReact !== false && <button className="rx rx-add" title="Добавить реакцию" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}><Icon name="plus" size={14} /></button>}
                  {canReact !== false && pickFor === m.id && <div className="rx-quick">
                    {QUICK.map(e => <button key={e} onClick={() => { onReact?.(m.id, e); setPickFor(null) }}><Em>{e}</Em></button>)}
                  </div>}
                </div>}
              </div>
              <div className="msg-tools">
                {/* v1.329.0: три частые реакции прямо в панели наведения, как в
                    Discord. Раньше до любой реакции было два действия — открыть
                    выбор и только потом ткнуть в эмодзи, из-за чего реакциями
                    почти не пользовались и лента выглядела мёртвой. */}
                {canReact !== false && onReact && QUICK.slice(0, 3).map(e => (
                  <button key={'q' + e} className="msg-tools-emo" title={'Реакция ' + e} onClick={() => onReact(m.id, e)}><Em>{e}</Em></button>
                ))}
                {onReply && <button title="Ответить" onClick={() => onReply(m)}><Icon name="reply" size={18} /></button>}
                {currentUser && <button title="Переслать" onClick={() => setFwdFor(m)}><Icon name="forward" size={18} /></button>}
                {canReact !== false && <button title="Реакция" onClick={() => setPickFor(pickFor === m.id ? null : m.id)}><Icon name="smile" size={18} /></button>}
                {/* v1.467.0: действия плагинов прямо при наведении, а не только
                    в меню по правой кнопке. До этого путь к ним был в два
                    действия — вызвать меню и найти пункт, — и ими попросту не
                    пользовались, ровно как когда-то реакциями.

                    Первые два: панель наведения узкая, и десяток чужих кнопок
                    в ней перекрыл бы наши собственные. Остальные остаются в
                    меню, где места сколько угодно. */}
                {pluginActions.slice(0, 2).map(a => (
                  <button key={'t' + a.pluginId + a.key} title={a.label + ' — плагин'}
                    onClick={() => { void invokePlugin(a.pluginId, a.onClick, [{ id: m.id, author: m.author, content: m.content ?? '' }]) }}>
                    <Icon name={a.icon} size={18} />
                  </button>
                ))}
                {canReact !== false && rx.length === 0 && pickFor === m.id && <div className="rx-quick tools-quick">
                  {QUICK.map(e => <button key={e} onClick={() => { onReact?.(m.id, e); setPickFor(null) }}><Em>{e}</Em></button>)}
                </div>}
                {m.author === currentUser && onStartEdit && m.content && !fwd && <button title="Изменить" onClick={() => onStartEdit(m)}><Icon name="edit" size={18} /></button>}
                <button title="Ещё" onClick={e => { setPickFor(null); setMenu({ id: m.id, x: e.clientX, y: e.clientY, sel: selNow() }) }}><Icon name="more" size={18} /></button>
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
        const item = (label: string, icon: string, fn: (e: React.MouseEvent) => void, cls = '', title?: string) => (
          <div className={'ctx-item' + cls} title={title} onClick={e => { fn(e); setMenu(null) }}><span>{label}</span><Icon name={icon} size={16} /></div>
        )
        return <>
        <div className="ctx-overlay" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null) }} />
        <div className="ctx-menu" ref={menuClamp.ref} style={menuClamp.style}>
          {canReact !== false && <div className="ctx-quick">
            {QUICK.slice(0, 4).map(e => <button key={e} onClick={() => { onReact?.(menu.id, e); setMenu(null) }}><Em>{e}</Em></button>)}
          </div>}
          {canReact !== false && <div className="ctx-item" onClick={() => { setEmojiAt({ id: menu.id, x: menu.x, y: menu.y }); setMenu(null) }}><span>Добавить реакцию</span><Icon name="chevron-right" size={16} /></div>}
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
          {/* v1.286.0: действия над сообщением от плагинов. Плагин получает только
              id, автора и текст — ни вложений, ни служебных полей. */}
          {pluginActions.length > 0 || pluginCtx.length > 0 || (pluginSel.length > 0 && menu.sel) ? <div className="ctx-sep" /> : null}
          {pluginActions.map(a => (
            <Fragment key={a.pluginId + ':' + a.key}>
              {item(a.label, a.icon, () => {
                void invokePlugin(a.pluginId, a.onClick, [{ id: menuMsg.id, author: menuMsg.author, content: menuMsg.content ?? '' }])
              })}
            </Fragment>
          ))}
          {/* v1.465.0: пункты из ponoi.ui.addContextMenu. Для сообщения плагин
              получает то же, что и в addMessageAction, — ни вложений, ни
              служебных полей. */}
          {pluginCtx.map(c => (
            <Fragment key={'ctx:' + c.pluginId + ':' + c.key}>
              {item(c.label, c.icon, () => {
                void invokePlugin(c.pluginId, c.onClick, [{ id: menuMsg.id, author: menuMsg.author, content: menuMsg.content ?? '' }])
              })}
            </Fragment>
          ))}
          {/* Пункты для выделенного текста показываются только когда текст
              действительно выделен: иначе это мёртвая строка в меню, которая
              ничего не делает. Плагину уходит ровно выделенное, а не всё
              сообщение — он просил «selection», а не «message». */}
          {menu.sel ? pluginSel.map(c => (
            <Fragment key={'sel:' + c.pluginId + ':' + c.key}>
              {item(c.label, c.icon, () => {
                void invokePlugin(c.pluginId, c.onClick, [{ text: menu.sel, messageId: menuMsg.id }])
              })}
            </Fragment>
          )) : null}
          {img ? <>
            <div className="ctx-sep" />
            {isGif ? item('Скопировать гифку', 'image', () => { copyGif(img) })
                   : item('Копировать изображение', 'image', () => { copyMedia(img) })}
            {item(isGif ? 'Сохранить гифку' : 'Сохранить изображение', 'download', () => { saveMedia(img) })}
            <div className="ctx-sep" />
            {item(isGif ? 'Копировать ссылку на гифку' : 'Копировать ссылку на изображение', 'link', () => { copyText(img, 'Ссылка скопирована') })}
            {item(isGif ? 'Открыть ссылку на гифку' : 'Открыть ссылку на изображение', 'external', () => { openSafely(img) })}
          </> : null}
          {(canDelete ? canDelete(menuMsg) : menuMsg.author === currentUser) ? <>
            <div className="ctx-sep" />
            {/* v1.445.0: уборка пачкой. Раньше десяток строк означал десяток
                правых щелчков и десяток подтверждений. */}
            {onSelectStart && item('Выбрать сообщения', 'check', () => onSelectStart(menu.id), '',
              'Отметить несколько и удалить разом')}
            {item('Удалить сообщение', 'trash', e => onDelete?.(menu.id, e.shiftKey), ' danger',
              'С зажатым Shift — удалить сразу, без вопроса')}
          </> : null}
          {devMode() ? <>
            <div className="ctx-sep" />
            {item('Копировать ID сообщения', 'id-card', () => { copyText(menuMsg.id, 'ID скопирован') })}
          </> : null}
        </div>
        </>
      })()}

      {emojiAt && <>
        <div className="ctx-overlay" onClick={() => setEmojiAt(null)} />
        <div className="ctx-emoji-pop" ref={emojiClamp.ref} style={emojiClamp.style} onClick={e => e.stopPropagation()}>
          <EmojiPicker onPick={e => { onReact?.(emojiAt.id, e); setEmojiAt(null) }} onClose={() => setEmojiAt(null)} />
        </div>
      </>}

      {fwdFor && currentUser && <ForwardModal src={fwdFor} meId={currentUser} meName={currentUserName ?? (localStorage.getItem('ponoi_username') || '?')} onClose={() => setFwdFor(null)} />}
    </>
  )
}