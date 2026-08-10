import { Popover } from './Popover'
import { toastErr } from '../lib/toast'
import { isSafeUrl } from '../lib/safeUrl'
import { stripAll } from '../lib/stripMeta'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../auth/AuthProvider'
import { isImage, isVideo } from '../lib/storage'
import { EmojiPicker } from './EmojiPicker'
import { loadCustom } from '../lib/emoji'
import { searchEmojiNames, emojiQueryAt } from '../lib/emojiNames'
import { GifPicker } from './GifPicker'
import { Icon } from './icons'
import { Avatar } from './Avatar'
import { Lightbox } from './Lightbox'
import { CodeFileCard, isCodeFile } from './CodeFileCard'
import { FileCard } from './FileCard'
import { PluginInstallCard, isPluginFile } from './PluginInstallCard'
import { useSettings } from '../lib/settings'
import type { AttachPatch } from '../lib/reactions'
import { usePresence } from '../lib/presence'
import { isQuicklaunchAvailable, type QlManifest } from '../lib/quicklaunch'
import { sysQuickLaunch, sysGameLink } from '../lib/sysmsg'
import { robloxJoinUrl, steamConnectUrl } from '../lib/gameShare'
import { ShareBuildModal, type ShareCardCustom } from './ShareBuildModal'
import { ShareGameLinkModal } from './ShareGameLinkModal'
import { fetchServerBotCommands, invokeBotCommand, type BotCommand } from '../lib/botApi'
import { useComposerButtons, useSlashCommands } from '../lib/plugins/registry'
import { runBeforeSend, hasInterceptors } from '../lib/plugins/middleware'
import { invokePlugin, claimHostContext, releaseHostContext, emitPluginEvent } from '../lib/plugins/bridge'
import { toast } from '../lib/toast'
import { confirmUi, promptUi } from '../lib/confirm'
import { slashPrefix, parseSlash, buildArgs, splitArgs, argHint } from '../lib/slashCmd'
import { shouldSend, hasSendable } from '../lib/sendKey'
import { keepFocus } from '../lib/keepFocus'
import { IS_MOBILE } from '../lib/mobile'

const MENTION_TAIL = /@([\p{L}\p{N}_.\-]*)$/u
// v1.352.0: подсказка эмодзи по «:», как в Discord и Telegram. Разбор хвоста
// живёт в lib/emojiNames — он проверяется тестом отдельно от разметки.
const EMOJI_SUGG_MAX = 8
const MAXLEN = 50000
// v1.150.0: лимит подняли до 50 000 символов — без анти-спам-проверки это была бы
// дыра для «залить чат 50 000 одинаковых букв». Реальный текст никогда не повторяет
// один и тот же символ подряд сотни раз, поэтому режем длинные однобуквенные пробеги.
const MAX_SAME_CHAR_RUN = 300
function hasSpamRun(t: string): boolean {
  let run = 1
  for (let i = 1; i < t.length; i++) {
    run = t[i] === t[i - 1] ? run + 1 : 1
    if (run > MAX_SAME_CHAR_RUN) return true
  }
  return false
}
// 40 ГБ — потолок для вложений (см. также migration 33: file_size_limit бакетов Storage).
const MAX_FILE_SIZE = 40 * 1024 ** 3

// Человекочитаемый размер файла для подсказки на ссылке скачивания.
function fmtSize(n: number): string {
  if (n < 1024) return n + ' Б'
  if (n < 1048576) return (n / 1024).toFixed(1) + ' КБ'
  return (n / 1048576).toFixed(1) + ' МБ'
}

// Команды-камодзи как в Discord: /shrug и компания.
const SLASH: Record<string, string> = {
  '/shrug': '\u00af\\_(\u30c4)_/\u00af',
  '/tableflip': '(\u256f\u00b0\u25a1\u00b0)\u256f\ufe35 \u253b\u2501\u253b',
  '/unflip': '\u252c\u2500\u252c \u30ce( \u309c-\u309c\u30ce)',
  '/lenny': '( \u0361\u00b0 \u035c\u0296 \u0361\u00b0)',
  '/happy': '(\u1d54\u25e1\u1d54)',
  '/cry': '(\u2565\ufe4f\u2565)',
  '/bear': '\u0295\u2022\u1d25\u2022\u0294',
}

// Типографика при отправке: -- становится тире, ... становится многоточием,
// случайные двойные пробелы схлопываются. Сообщения с кодом (`) не трогаем.
function polish(t: string): string {
  if (t.includes('\u0060')) return t
  return t.replace(/--/g, '\u2014').replace(/\.\.\./g, '\u2026').replace(/ {2,}/g, ' ')
}

function applySlash(t: string): string {
  const sp = t.indexOf(' ')
  const cmd = (sp === -1 ? t : t.slice(0, sp)).toLowerCase()
  const rep = SLASH[cmd]
  if (!rep) return t
  const rest = sp === -1 ? '' : t.slice(sp + 1).trim()
  return rest ? rest + ' ' + rep : rep
}

// v1.248.0: медленный режим — метка вида '5с'/'10м'/'2ч' из ChannelSettings.tsx
// (SLOW_OPTS) в секунды. 'Выкл'/пусто/незнакомый формат — 0 (выключено).
function slowModeSeconds(label?: string): number {
  if (!label || label === 'Выкл') return 0
  const m = label.match(/^(\d+)(с|м|ч)$/)
  if (!m) return 0
  const n = Number(m[1])
  return m[2] === 'с' ? n : m[2] === 'м' ? n * 60 : n * 3600
}

export function Composer({ placeholder, onSend, replyingTo, onCancelReply, onType, mentionables, mentionableRoles, draftKey, editingTarget, onSaveEdit, onCancelEdit, serverId, channelId, canAttachFiles, canMentionEveryone, canMentionRoles, slowMode, automodCheck, channelName, serverName, readState }:
  // v1.185.0: files — сырые файлы для отправки «как в Discord»: composer отдаёт
  // локальный blob-превью сразу (attach.url), а саму заливку на сервер и подмену
  // на настоящий URL делает вызывающая сторона (sendMsg в ServerView/DMHome) уже
  // ПОСЛЕ того, как сообщение появилось в ленте — без attach.files это как раньше.
  { placeholder: string; onSend: (text: string, attach?: { url: string; type: string }, files?: File[]) => Promise<void>;
    replyingTo?: { author: string; preview: string; avatarUrl?: string | null } | null; onCancelReply?: () => void; onType?: () => void;
    mentionables?: string[]
    // v1.239.0: роли сервера, доступные для @упоминания в автокомплите — только
    // серверы (ЛС/группы ролей не имеют).
    mentionableRoles?: { name: string; color: string }[]
    draftKey?: string
    // v1.177.0: редактирование сообщения — как в Discord, текст загружается прямо
    // в строку набора вместо инлайн-текстареи внутри самого сообщения.
    editingTarget?: { id: string; content: string } | null
    onSaveEdit?: (text: string) => void | Promise<void>
    onCancelEdit?: () => void
    // v1.193.0: слэш-команды ботов — только на серверах (в ЛС ботов нет), нужен
    // channelId/serverId, чтобы найти команды ботов, реально стоящих на сервере.
    serverId?: string; channelId?: string
    // v1.360.0: названия нужны плагинам с разрешением «context» — чтобы понимать,
    // где они работают. Необязательные: у ветки и лички своего названия нет.
    channelName?: string; serverName?: string
    // v1.477.0: докуда дочитал собеседник. Есть только в личке — в канале
    // отметки «просмотрено» нет и быть не может: читателей там много.
    readState?: () => { at: number | null; seenLabel: string | null; on: boolean } | null
    // v1.198.0: права ATTACH_FILES/MENTION_EVERYONE — undefined (ЛС, где прав нет) значит «можно».
    canAttachFiles?: boolean; canMentionEveryone?: boolean
    // v1.239.0: MENTION_ROLES — недоступно по умолчанию (в отличие от MENTION_EVERYONE),
    // undefined (ЛС) значит «можно» (там и ролей-то нет).
    canMentionRoles?: boolean
    // v1.248.0: медленный режим канала — метка из ChannelSettings.tsx (SLOW_OPTS:
    // 'Выкл'/'5с'/.../'6ч'), undefined — как «Выкл» (ЛС, где медленного режима нет).
    slowMode?: string
    // v1.264.0/v1.267.0: автомод (ServerView.tsx уже отфильтровал по правам —
    // владельцу/модератору сюда придёт undefined) — проверяем ДО onSend, а не
    // внутри него, иначе текст в поле уже стёрся бы (см. очистку ниже) раньше,
    // чем стало известно, что отправка заблокирована. Возвращает причину блокировки
    // (текст тоста) или null, если можно отправлять.
    automodCheck?: (text: string) => string | null }) {
  const { user } = useAuth()
  const { settings } = useSettings()
  const { gameOf } = usePresence()
  const [text, setText] = useState('')
  const [shareBuild, setShareBuild] = useState(false)
  // v1.192.0: 'roblox' | 'cs2' | 'terraria' — какая игра сейчас в модалке «Поделиться игрой».
  const [shareGameLink, setShareGameLink] = useState<'roblox' | 'cs2' | 'terraria' | false>(false)
  const isEditing = !!editingTarget
  const preEditText = useRef<string | null>(null)
  // v1.70.0: несколько вложений в одном сообщении (как в Discord, до 10).
  const [files, setFiles] = useState<File[]>([])
  const [spoilers, setSpoilers] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [emoji, setEmoji] = useState(false)
  const [gif, setGif] = useState(false)
  const [mQ, setMQ] = useState<string | null>(null)
  const [mIdx, setMIdx] = useState(0)
  // Отдельный запрос для эмодзи: с «@» они не пересекаются — двоеточие обрывает
  // хвост упоминания, — но своё состояние нужно, чтобы стрелки ходили по своему списку.
  const [eQ, setEQ] = useState<string | null>(null)
  const [eIdx, setEIdx] = useState(0)
  // v1.460.0: сами значки — чтобы нажатие по ним не считалось «мимо».
  const emojiBtn = useRef<HTMLButtonElement>(null)
  const gifBtn = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastSent = useRef<{ t: string; at: number }>({ t: '', at: 0 })
  // v1.248.0: медленный режим — время последней отправки НА КАЖДЫЙ канал отдельно
  // (composer один на весь ServerView, переиспользуется при переключении каналов —
  // общий таймер на всех каналах сразу перепутал бы кулдаун между ними).
  const lastSendByChannel = useRef<Record<string, number>>({})
  // v1.42.0: синхронный замок от двойной отправки (второй Enter до того, как busy успеет выставиться)
  const sendingRef = useRef(false)
  // Сообщение, которое не ушло из-за сбоя сети: текст остаётся в поле, баннер даёт повторить одной кнопкой.
  const [failed, setFailed] = useState(false)
  // Предпросмотр картинки до отправки (v1.28.0): миниатюра + спойлер/просмотр/убрать.
  const [previews, setPreviews] = useState<string[]>([])
  const [pvOpen, setPvOpen] = useState<string | null>(null)
  useEffect(() => {
    const urls = files.map(f => isImage(f) ? URL.createObjectURL(f) : '')
    setPreviews(urls)
    return () => { urls.forEach(u => { if (u) URL.revokeObjectURL(u) }); setPvOpen(null) }
  }, [files])
  const MAXFILES = 10
  async function addFiles(fsRaw: File[]) {
    if (fsRaw.length === 0) return
    // v1.305.0: снимаем метаданные СРАЗУ при прикреплении, а не перед отправкой.
    // Так очищенный файл идёт и в предпросмотр, и в шифрование, и в загрузку —
    // одно место вместо трёх, и нет пути, по которому исходник с координатами
    // проскользнул бы мимо очистки.
    const { files: fs, failed } = await stripAll(fsRaw)
    if (failed.length) {
      toastErr('Не удалось очистить метаданные: ' + failed.join(', ') + '. Файл отправится как есть.')
    }
    const tooBig = fs.filter(f => f.size > MAX_FILE_SIZE)
    if (tooBig.length) toastErr('Слишком большой файл (максимум 40 ГБ): ' + tooBig.map(f => f.name).join(', '))
    const ok = fs.filter(f => f.size <= MAX_FILE_SIZE)
    if (ok.length === 0) return
    setFiles(prev => {
      const next = [...prev, ...ok]
      if (next.length > MAXFILES) toastErr('Не больше ' + MAXFILES + ' вложений в одном сообщении')
      return next.slice(0, MAXFILES)
    })
  }
  function removeFile(i: number) {
    setFiles(prev => prev.filter((_, x) => x !== i))
    setSpoilers(s => {
      const n: Record<number, boolean> = {}
      Object.keys(s).forEach(k => { const ki = Number(k); if (ki < i) n[ki] = s[ki]; else if (ki > i) n[ki - 1] = s[ki] })
      return n
    })
  }
  // Меню «плюса» слева (Фото / Файл / Папка / Голосовое) — как в Discord.
  const [plusMenu, setPlusMenu] = useState(false)
  // Синяя «отправить» появляется ровно тогда, когда сообщение правда уйдёт:
  // правило то же самое, что у submit (hasSendable), а не «в поле что-то есть».
  // Иначе вышло бы привычное расхождение — кнопка обещает, нажатие молчит.
  const hasContent = hasSendable(text, files.length)
  // v1.528.0: пока открыта шторка эмодзи, переписка и строка ввода поднимаются
  // над ней — как в мобильном Discord, где панель занимает место клавиатуры, а
  // не накрывает собой ввод. Отметка на теле страницы: высоту шторки знает
  // только стиль, и считать её здесь заново значило бы дать двум местам
  // разойтись.
  useEffect(() => {
    if (!IS_MOBILE) return
    const открыта = emoji || gif
    document.body.classList.toggle('pick-open', открыта)
    return () => { document.body.classList.remove('pick-open') }
  }, [emoji, gif])
  const photoRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  // Запись голосового: { t } — секунды записи; recRef держит MediaRecorder.
  const [rec, setRec] = useState<{ t: number } | null>(null)
  const recRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; timer: number; cancel: boolean } | null>(null)

  // Черновики: текст хранится отдельно для каждого канала/ЛС и переживает перезагрузку.
  // v1.262.0: Composer — один и тот же инстанс на весь ServerView/DMHome, канал
  // меняется только через draftKey. Раньше вложения/спойлеры/запись голосового не
  // сбрасывались при смене канала — прикреплённый в канале A файл (или начатая
  // запись) молча улетал(а) в канал B при отправке оттуда, без единого намёка,
  // что вложение «переехало».
  useEffect(() => {
    if (draftKey === undefined || isEditing) return
    setText(localStorage.getItem('ponoi_draft_' + draftKey) ?? '')
    setMQ(null)
    setFiles([])
    setSpoilers({})
    stopRec(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey])
  function keepDraft(v: string) {
    if (draftKey === undefined || isEditing) return   // во время редактирования текст поля — не черновик
    if (v) localStorage.setItem('ponoi_draft_' + draftKey, v)
    else localStorage.removeItem('ponoi_draft_' + draftKey)
  }

  // v1.177.0: вход/выход из редактирования — подставляем текст сообщения в поле
  // (сохранив прежний черновик набора) и возвращаем черновик обратно при отмене.
  useEffect(() => {
    if (editingTarget) {
      if (preEditText.current === null) preEditText.current = text
      setText(editingTarget.content)
      setEmoji(false); setGif(false)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        const l = editingTarget.content.length
        el.setSelectionRange(l, l)
      })
    } else if (preEditText.current !== null) {
      setText(preEditText.current)
      preEditText.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTarget?.id])

  // v1.163.0: многострочный композер — поле растёт вместе с текстом (Shift+Enter —
  // новая строка, как в Discord), CSS max-height/overflow-y ограничивают рост дальше.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [text])

  // Любая буква/цифра возвращает фокус в строку ввода, где бы ни был курсор (как в Discord).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Начало редактирования сообщения закрывает панели эмодзи/GIF: иначе они висят
  // поверх строки, в которой уже другой текст.
  // v1.330.0: раньше это делалось по событию 'ponoi-close-pickers', которое никто
  // и никогда не посылал — панели так и оставались открытыми. Смотрим прямо на
  // признак редактирования, слать событие из четырёх мест незачем.
  useEffect(() => {
    if (editingTarget) { setEmoji(false); setGif(false) }
  }, [editingTarget?.id])

  // Drag-and-drop файла в чат + вставка картинки из буфера (Ctrl+V).
  const [drag, setDrag] = useState(false)
  const dragDepth = useRef(0)
  useEffect(() => {
    // v1.127.0: перетаскивания, начавшиеся ВНУТРИ приложения (картинка из чата, аватарка и т.п.),
    // не считаются вложениями — прикрепить можно только файлы, притащенные снаружи (из проводника).
    let internalDrag = false
    const dstart = () => { internalDrag = true }
    const dend = () => { internalDrag = false }
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => { if (internalDrag || !hasFiles(e)) return; e.preventDefault(); dragDepth.current++; setDrag(true) }
    const over = (e: DragEvent) => { if (!internalDrag && hasFiles(e)) e.preventDefault() }
    const leave = (e: DragEvent) => { if (internalDrag || !hasFiles(e)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDrag(false) }
    const drop = (e: DragEvent) => {
      if (internalDrag) { e.preventDefault(); internalDrag = false; dragDepth.current = 0; setDrag(false); return }
      if (!hasFiles(e)) return
      e.preventDefault(); dragDepth.current = 0; setDrag(false)
      const fs = Array.from(e.dataTransfer?.files ?? [])
      if (fs.length) { addFiles(fs); inputRef.current?.focus() }
    }
    window.addEventListener('dragstart', dstart, true)
    window.addEventListener('dragend', dend, true)
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragstart', dstart, true)
      window.removeEventListener('dragend', dend, true)
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  // Автодополнение @упоминаний: @everyone/@here + роли сервера + имена участников
  // (v1.239.0: роли — отдельная категория, визуально отличаются цветом и подписью «роль».
  // v1.248.0: @here — как в Discord, оповещает только тех, кто сейчас в сети, а не всех;
  // право то же самое, что у @everyone — canMentionEveryone).
  interface MentionSugg { name: string; kind: 'everyone' | 'here' | 'role' | 'user'; color?: string }
  const mentionSuggAll: MentionSugg[] = [
    { name: 'everyone', kind: 'everyone' as const },
    { name: 'here', kind: 'here' as const },
    ...(mentionableRoles ?? []).map(r => ({ name: r.name, kind: 'role' as const, color: r.color })),
    ...(mentionables ?? []).map(n => ({ name: n, kind: 'user' as const })),
  ].filter(s => s.name)
  const sugg = mQ !== null
    ? mentionSuggAll.filter(s => s.name.toLowerCase().startsWith(mQ.toLowerCase())).slice(0, 8)
    : []

  // Свои и серверные эмодзи идут первыми: их ставили руками именно для этого чата,
  // и вставляются они как :имя: — тем же текстом, который потом рисует md.
  interface EmojiSugg { name: string; char?: string; url?: string }
  const emojiSugg: EmojiSugg[] = (() => {
    if (eQ === null) return []
    const q = eQ.toLowerCase()
    const custom = loadCustom()
    const own: EmojiSugg[] = Object.keys(custom)
      .filter(n => n.toLowerCase().includes(q))
      .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)) || a.localeCompare(b))
      .slice(0, EMOJI_SUGG_MAX)
      .map(n => ({ name: n, url: custom[n] }))
    const uni = searchEmojiNames(q, EMOJI_SUGG_MAX - own.length)
      .map(e => ({ name: e.name, char: e.char }))
    return [...own, ...uni]
  })()

  // v1.193.0: слэш-команды ботов — только в начале сообщения (как в Discord),
  // список — команды ботов, реально стоящих на этом сервере (в ЛС нет serverId — нет команд).
  const [botCmds, setBotCmds] = useState<(BotCommand & { botAppId: string })[]>([])
  const [cmdIdx, setCmdIdx] = useState(0)
  const [cmdBusy, setCmdBusy] = useState(false)
  useEffect(() => {
    if (!serverId) { setBotCmds([]); return }
    let ok = true
    fetchServerBotCommands(serverId).then(c => { if (ok) setBotCmds(c) })
    return () => { ok = false }
  }, [serverId])
  // v1.286.0: команды и кнопки плагинов. Живут рядом с командами ботов, но работают
  // и в ЛС тоже: плагин стоит на устройстве, ему не нужен serverId.
  const pluginCmds = useSlashCommands()
  const pluginButtons = useComposerButtons()
  // Плагину нужен способ отправить сообщение и показать уведомление, а «куда
  // отправить» знает только открытое сейчас поле ввода.
  //
  // v1.293.0: полей ввода на экране до ТРЁХ одновременно — личка, канал сервера и
  // открытая ветка смонтированы разом. Раньше каждое просто присваивало контекст на
  // каждом своём рендере, и побеждало то, которое отрисовалось последним: плагин мог
  // отправить сообщение в чат, которого человек даже не видит, причём непредсказуемо.
  // Теперь право отвечать за отправку ЗАНИМАЮТ: пустое место занимает любой (чтобы
  // плагин мог написать и до первого клика), а дальше право забирает то поле, в
  // которое человек поставил курсор (onFocus у textarea ниже).
  const ctxIdRef = useRef('composer-' + Math.random().toString(36).slice(2))
  // onSend через ref, а не в зависимостях эффекта: родитель пересоздаёт эту функцию
  // на каждом рендере, и эффект срабатывал бы вхолостую без конца.
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend
  // Через ref по той же причине, что и onSend: родитель пересоздаёт функцию
  // на каждом рендере, а контекст плагина захватывается один раз.
  const readStateRef = useRef(readState)
  readStateRef.current = readState
  const claimCtx = (force: boolean) => claimHostContext(ctxIdRef.current, {
    sendMessage: async text => { await onSendRef.current(text) },
    toast: msg => toast(msg),
    // v1.360.0: обстановка и вопросы к человеку. Окна рисует приложение — плагин
    // получает только ответ: своё окно он подделал бы под любое окно Ponoi.
    me: () => (user ? { id: user.id, name: user.user_metadata?.display_name ?? user.email ?? '' } : null),
    channel: () => (channelId
      ? { id: channelId, name: channelName ?? '', serverId: serverId ?? null, serverName: serverName ?? null }
      : null),
    confirm: (title, text, ok) => confirmUi(text ? title + '\n' + text : title, { okText: ok }),
    prompt: (title, placeholder, value) => promptUi(title, { placeholder, initial: value }),
    // v1.477.0: плагин спрашивает — приложение отвечает. Своей дороги к базе
    // у плагина нет и не будет.
    readState: async () => (readStateRef.current ? readStateRef.current() : null),
  }, force)
  useEffect(() => {
    const id = ctxIdRef.current
    claimCtx(false)
    return () => releaseHostContext(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // v1.397.0: событие о переходе в другой канал. Плагин и раньше мог спросить
  // ponoi.channel(), но узнать, что канал сменился, было неоткуда — оставалось
  // опрашивать по таймеру, чего никто делать не должен.
  const lastChanRef = useRef<string | null>(null)
  useEffect(() => {
    const id = channelId ?? null
    if (lastChanRef.current === id) return
    lastChanRef.current = id
    if (!id) return
    emitPluginEvent('channel', {
      id, name: channelName ?? '', serverId: serverId ?? null,
      kind: serverId ? 'channel' : 'dm',
    })
  }, [channelId, channelName, serverId])

  // v1.356.0: и боты, и плагины разбираются одной регуляркой с \p{L}. Раньше у
  // ботов стояла \w — только латиница, — и ни одна русская команда готового бота
  // (/кубик, /опрос, /шар) не подсказывалась и не срабатывала вовсе.
  const slashTyping = slashPrefix(text)
  const cmdSugg = slashTyping !== null ? botCmds.filter(c => c.name.startsWith(slashTyping)).slice(0, 8) : []
  const pluginCmdSugg = slashTyping !== null
    ? pluginCmds.filter(c => c.name.startsWith(slashTyping)).slice(0, 8)
    : []

  // v1.475.0: подсказка по доводам команды плагина.
  //
  // Она появляется ПОСЛЕ имени команды — то есть там, где человек до сих пор
  // видел пустоту и должен был откуда-то знать, что писать дальше. Значения
  // берутся либо из объявленных плагином (options), либо у него самого
  // (onComplete): второе нужно всему, что зависит от живых данных — списку
  // треков, каналов, заметок.
  const набранная = parseSlash(text)
  const активная = набранная && /\s/.test(text)
    ? pluginCmds.find(c => c.name === набранная.name && (c.args?.length ?? 0) > 0)
    : undefined
  const состояние = активная ? splitArgs(набранная!.rest, активная.args!) : null
  const текущийДовод = активная && состояние && состояние.current >= 0
    ? активная.args![состояние.current] : null
  const [подсказки, setПодсказки] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    if (!активная || !текущийДовод || !состояние) { setПодсказки([]); return }
    // Свои значения — сразу, без похода в плагин.
    if (текущийДовод.options?.length) {
      const p = состояние.prefix.toLowerCase()
      setПодсказки(текущийДовод.options.filter(o => o.label.toLowerCase().includes(p)).slice(0, 8))
      return
    }
    if (!активная.complete) { setПодсказки([]); return }
    // Плагин спрашивается с задержкой: он может ходить в сеть, и дёргать его на
    // каждую букву — верный способ подвесить поле ввода.
    let живо = true
    const t = setTimeout(async () => {
      try {
        const r = await invokePlugin(активная.pluginId, активная.complete!, [
          текущийДовод.name, состояние.prefix, состояние.values,
        ])
        if (!живо) return
        const список = (Array.isArray(r) ? r : []).slice(0, 8).map((v: any) => ({
          value: String(v?.value ?? v).slice(0, 60),
          label: String(v?.label ?? v?.value ?? v).slice(0, 60),
        }))
        setПодсказки(список)
      } catch { if (живо) setПодсказки([]) }
    }, 180)
    return () => { живо = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  /** Подставить значение в набираемый довод. */
  function pickArg(v: string) {
    if (!активная || !состояние) return
    const без = состояние.prefix ? text.slice(0, text.length - состояние.prefix.length) : text
    // Пробел после — чтобы сразу набирался следующий довод. У последнего его не
    // ставим: он забирает остаток строки, и лишний пробел там только мешает.
    const последний = состояние.current >= активная.args!.length - 1
    setText(без + v + (последний ? '' : ' '))
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  /** Команда плагина: /имя остаток-строки. Вернёт true, если команда нашлась и отработала. */
  async function runPluginCommand(cmdText: string): Promise<boolean> {
    const m = /^\/([\p{L}\p{N}_-]+)(?:\s+([\s\S]*))?$/u.exec(cmdText.trim())
    if (!m) return false
    const cmd = pluginCmds.find(c => c.name === m[1].toLowerCase())
    if (!cmd) return false
    setCmdBusy(true)
    try {
      // Аргументы отдаём одной строкой: плагин сам решает, как их разбирать, — в
      // отличие от команд ботов, где раскладка по options задана заранее.
      //
      // v1.475.0: а если плагин ОПИСАЛ доводы — вторым доводом идут они же,
      // разложенные по именам. Первый остался строкой нарочно: плагины,
      // написанные по прежней инструкции, не должны сломаться.
      const хвост = (m[2] ?? '').trim()
      const разложены = cmd.args?.length ? splitArgs(хвост, cmd.args).values : undefined
      await invokePlugin(cmd.pluginId, cmd.handler, разложены ? [хвост, разложены] : [хвост])
      setText(''); keepDraft('')
    } catch { /* причину уже показал invokePlugin */ }
    finally { setCmdBusy(false) }
    return true
  }
  function pickCommand(c: BotCommand & { botAppId: string }) {
    setText('/' + c.name + ' ')
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  // /имя аргумент1 аргумент2 — позиционно раскладывается по options команды.
  async function runSlashCommand(cmdText: string): Promise<boolean> {
    const p = parseSlash(cmdText)
    if (!p || !serverId || !channelId) return false
    const cmd = botCmds.find(c => c.name === p.name)
    if (!cmd) return false
    const args = buildArgs(p.rest, cmd.options ?? [])
    setCmdBusy(true)
    try {
      await invokeBotCommand(cmd.botAppId, channelId, cmd.name, args)
      setText(''); keepDraft('')
    } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setCmdBusy(false) }
    return true
  }

  function updateMention(v: string, caret: number | null) {
    const upto = v.slice(0, caret ?? v.length)
    const m = upto.match(MENTION_TAIL)
    setMQ(m ? m[1] : null)
    setMIdx(0)
    setEQ(m ? null : emojiQueryAt(upto, upto.length))
    setEIdx(0)
  }

  // Юникодный эмодзи вставляем самим символом, свой — записью :имя:, потому что
  // картинку рисует уже разметка сообщения по этому имени.
  function pickEmoji(it: { name: string; char?: string; url?: string }) {
    const el = inputRef.current
    const caret = el?.selectionStart ?? text.length
    const upto = text.slice(0, caret)
    const q = emojiQueryAt(upto, upto.length)
    if (q === null) { setEQ(null); return }
    const ins = (it.char ?? ':' + it.name + ':') + ' '
    const start = caret - (q.length + 1)
    const next = text.slice(0, start) + ins + text.slice(caret)
    setText(next); keepDraft(next)
    setEQ(null)
    requestAnimationFrame(() => {
      const p = start + ins.length
      el?.focus(); el?.setSelectionRange(p, p)
    })
  }

  function pickMention(name: string) {
    const el = inputRef.current
    const caret = el?.selectionStart ?? text.length
    const upto = text.slice(0, caret)
    const m = upto.match(MENTION_TAIL)
    if (!m) { setMQ(null); return }
    const start = caret - m[0].length
    const next = text.slice(0, start) + '@' + name + ' ' + text.slice(caret)
    setText(next)
    setMQ(null)
    requestAnimationFrame(() => {
      const p = start + name.length + 2
      el?.focus(); el?.setSelectionRange(p, p)
    })
  }

  // Горячие клавиши форматирования: оборачивают выделенный текст маркдауном (как в Discord).
  function wrapFormat(marker: string) {
    const el = inputRef.current
    if (!el) return
    const s = el.selectionStart ?? text.length, en = el.selectionEnd ?? s
    const sel = text.slice(s, en)
    const nv = text.slice(0, s) + marker + sel + marker + text.slice(en)
    setText(nv); keepDraft(nv)
    requestAnimationFrame(() => {
      el.focus()
      if (sel) el.setSelectionRange(s + marker.length, en + marker.length)
      else { const p = s + marker.length; el.setSelectionRange(p, p) }
    })
  }

  function insertEmoji(t: string) { setText(x => { const nv = x + t; keepDraft(nv); return nv }); setEmoji(false) }
  async function sendGif(url: string) {
    setGif(false)
    if (!user) return
    setBusy(true)
    try { await onSend('', { url, type: 'image' }) } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }
  // v1.250.0: стикер — как GIF, но attach_type='sticker' (см. MessageList.tsx/
  // Composer.tsx Attachment — рендерится крупнее и без рамки вложения, как в Discord).
  async function sendSticker(url: string, name: string) {
    setGif(false)
    if (!user) return
    setBusy(true)
    try { await onSend('', { url, type: 'sticker:' + name }) } catch (err: any) { toastErr(err.message ?? String(err)) }
    finally { setBusy(false) }
  }

  // Выбор папки (v1.70.0): файлы прикрепляются к сообщению группой (до 10),
  // можно добавить подпись и отправить всё одним сообщением.
  async function sendFiles(fs: File[]) {
    if (fs.length === 0) return
    addFiles(fs)
    inputRef.current?.focus()
  }

  // Голосовое сообщение: запись с микрофона, капсула с таймером, отмена/отправка.
  async function startRec() {
    if (recRef.current || !user) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop())
        const st = recRef.current
        recRef.current = null
        setRec(null)
        if (!st || st.cancel || !user) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        if (blob.size < 500) return
        const f = new File([blob], 'voice_' + Date.now() + '.webm', { type: 'audio/webm' })
        // v1.185.0: как и с файлами — сообщение появляется сразу (blob-превью
        // играбелен локально), заливка в фоне (см. sendMsg).
        try { await onSend('', { url: URL.createObjectURL(f), type: 'audio' }, [f]) }
        catch (err: any) { toastErr(err.message ?? String(err)) }
      }
      mr.start()
      const timer = window.setInterval(() => setRec(r => r ? { t: r.t + 1 } : r), 1000)
      recRef.current = { mr, chunks, timer, cancel: false }
      setRec({ t: 0 })
    } catch { toastErr('Микрофон недоступен — проверь доступ в системе') }
  }
  function stopRec(send: boolean) {
    const st = recRef.current
    if (!st) return
    st.cancel = !send
    window.clearInterval(st.timer)
    try { st.mr.stop() } catch {}
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || sendingRef.current || cmdBusy) return   // v1.42.0: защита от двойной отправки
    // Команды плагинов проверяются первыми: они локальные и не ходят в сеть, а имя
    // может совпасть с командой бота — приоритет у того, что стоит у тебя самого.
    if (!isEditing && pluginCmds.length && /^\/[\p{L}\p{N}_-]+/u.test(text.trim()) && await runPluginCommand(text)) return
    // Тот же \p{L}, что и у плагинов строкой выше: с \w сюда не доходила ни одна
    // русская команда бота, и «/кубик» просто улетал в чат обычным сообщением.
    if (!isEditing && botCmds.length && parseSlash(text) && await runSlashCommand(text)) return
    if (isEditing) {
      const t = text.trim()
      sendingRef.current = true
      setBusy(true)
      try {
        await onSaveEdit?.(t)
        preEditText.current = null   // сохранили правку — черновик восстанавливать не нужно
        setText('')
      } catch (err: any) { toastErr(err.message ?? String(err)) }
      finally { setBusy(false); sendingRef.current = false }
      return
    }
    let t = polish(applySlash(text.trim()))
    if ((!t && files.length === 0) || !user) return
    // Блокировка сообщений, состоящих только из пробелов и невидимых символов юникода.
    if (!hasSendable(t, files.length)) return
    // Защита от дублей: одно и то же сообщение дважды подряд за секунду не уходит.
    if (t && files.length === 0 && t === lastSent.current.t && Date.now() - lastSent.current.at < 1000) return
    if (t.length > MAXLEN) { toastErr('Сообщение слишком длинное — максимум ' + MAXLEN + ' символов'); return }
    if (t && hasSpamRun(t)) { toastErr('Слишком много одинаковых символов подряд'); return }
    if (files.length && canAttachFiles === false) { toastErr('У вас нет прав на прикрепление файлов'); return }
    if (t && automodCheck) {
      const reason = automodCheck(t)
      if (reason) { toastErr(reason); return }
    }
    if (t && canMentionEveryone === false && /@everyone(?![\p{L}\p{N}_])/u.test(t)) { toastErr('У вас нет прав на упоминание @everyone'); return }
    // v1.248.0: @here — то же право, что у @everyone (как в Discord).
    if (t && canMentionEveryone === false && /@here(?![\p{L}\p{N}_])/u.test(t)) { toastErr('У вас нет прав на упоминание @here'); return }
    // v1.239.0: MENTION_ROLES — недоступно по умолчанию, проверяем только реальные
    // имена ролей сервера (mentionableRoles), а не любой @текст — иначе заблокировали
    // бы и обычные упоминания людей, чьё имя случайно совпало с чем-то в тексте.
    if (t && canMentionRoles === false && mentionableRoles?.some(r => {
      const esc = r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      try { return new RegExp('@' + esc + '(?![\\p{L}\\p{N}_])', 'iu').test(t) } catch { return false }
    })) { toastErr('У вас нет прав на упоминание ролей'); return }
    // v1.248.0: медленный режим канала — включается в ChannelSettings.tsx (SLOW_OPTS),
    // раньше только сохранялся и нигде не применялся. Проверка на клиенте (без
    // серверного лимита) — как и остальные проверки прав в этом файле.
    if (channelId) {
      const slowSec = slowModeSeconds(slowMode)
      const lastAt = lastSendByChannel.current[channelId] ?? 0
      const waitMs = slowSec * 1000 - (Date.now() - lastAt)
      if (slowSec > 0 && waitMs > 0) { toastErr('Медленный режим — подожди ещё ' + Math.ceil(waitMs / 1000) + ' с'); return }
    }
    sendingRef.current = true
    setBusy(true)
    try {
      // v1.465.0: перехватчики плагинов — последними, после всех проверок прав.
      //
      // Порядок важен: плагин правит то, что человек действительно имеет право
      // отправить. Если бы перехват шёл раньше, плагин мог бы дописать @everyone
      // человеку, которому упоминания запрещены, и проверка выше уже прошла бы.
      //
      // Ничего не делает, пока перехватчиков нет, — то есть у подавляющего
      // большинства путь отправки остаётся ровно прежним, байт в байт.
      if (t && hasInterceptors('send')) {
        const r = await runBeforeSend(t, channelId ?? null,
          (pid, fn, a) => invokePlugin(pid, fn, a))
        if (r.cancel) {
          // Отмена — это действие плагина, а не сбой сети: человек обязан
          // понять, ПОЧЕМУ его сообщение не ушло, и кто именно его отменил.
          toastErr('Сообщение отменено плагином «' + (r.by ?? '?') + '»')
          setBusy(false); sendingRef.current = false
          return
        }
        t = r.content
      }
      let attach: { url: string; type: string } | undefined
      const pendingFiles = files
      if (files.length) {
        // v1.185.0: не грузим на сервер до отправки (как раньше — с полосой над
        // композером) — сообщение должно появиться в ленте мгновенно, локальный
        // blob-превью тут же и заменяет собой ожидание сети; настоящая заливка
        // идёт в фоне уже после того, как сообщение видно (см. sendMsg).
        const urls = files.map((f, i) => { let u = URL.createObjectURL(f); if (spoilers[i] && isImage(f)) u += '#spoiler'; return u })
        const types = files.map(f => isImage(f) ? 'image' : isVideo(f) ? 'video' : 'file')
        attach = { url: urls.join('\n'), type: types.join('\n') }
      }
      await onSend(t, attach, pendingFiles.length ? pendingFiles : undefined)
      lastSent.current = { t, at: Date.now() }
      if (channelId) lastSendByChannel.current[channelId] = Date.now()
      setFailed(false)
      setText(''); keepDraft(''); setFiles([]); setSpoilers({}); setMQ(null); setEQ(null); if (fileRef.current) fileRef.current.value = ''; if (photoRef.current) photoRef.current.value = ''
      // Подстраховка: если фокус всё же ушёл (например, отправили с клавиатуры
      // на компьютере или из другого места), вернём его в поле — писать дальше
      // человек будет туда же.
      if (document.activeElement !== inputRef.current) inputRef.current?.focus()
    } catch (err: any) { setFailed(true); toastErr(err.message ?? String(err)) }
    finally { setBusy(false); sendingRef.current = false }
  }

  return (
    <>
      {drag && <div className="drop-overlay"><div className="drop-box">Отпусти, чтобы прикрепить файл<small>картинки, документы — что угодно</small></div></div>}
      {failed && !busy && <div className="send-fail">
        Сообщение не отправлено — проверь соединение
        <button type="button" onClick={e => { setFailed(false); submit(e as any) }}>Повторить</button>
        <button type="button" className="send-fail-x" title="Скрыть" onClick={() => setFailed(false)}>×</button>
      </div>}
      {files.length > 0 && <div className="att-row">
        {files.map((f, i) => isImage(f) && previews[i] ? (
          <div key={i} className="att-card">
            <div className="att-card-actions">
              <button type="button" className={'att-act' + (spoilers[i] ? ' on' : '')} title={spoilers[i] ? 'Картинка будет спойлером' : 'Отправить как спойлер'} onClick={() => setSpoilers(s => ({ ...s, [i]: !s[i] }))}><span className="att-sp">| |</span></button>
              <button type="button" className="att-act" title="Посмотреть" onClick={() => setPvOpen(previews[i])}><Icon name="zoom-in" size={16} /></button>
              <button type="button" className="att-act danger" title="Убрать вложение" onClick={() => removeFile(i)}><Icon name="trash" size={16} /></button>
            </div>
            <div className="att-thumb">
              <img src={previews[i]} alt="" className={spoilers[i] ? 'blurred' : ''} />
              {spoilers[i] && <span className="att-spoiler-tag">СПОЙЛЕР</span>}
            </div>
            <div className="att-card-nm" title={f.name}>{f.name}</div>
            <div className="att-card-sz">{fmtSize(f.size)}</div>
          </div>
        ) : (
          <div key={i} className="file-chip">
            <Icon name="paperclip" size={14} /> <b className="file-chip-nm">{f.name}</b> <span className="file-chip-sz">{fmtSize(f.size)}</span>
            <button type="button" className="file-chip-x" title="Убрать файл" onClick={() => removeFile(i)}><Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>}
      {pvOpen && <Lightbox url={pvOpen} onClose={() => setPvOpen(null)} />}
      {isEditing
        ? <div className="reply-banner edit-banner">
            <Icon name="edit" size={14} /> Редактирование сообщения
            <button type="button" title="Отменить (Esc)" onClick={() => onCancelEdit?.()}><Icon name="close" size={14} /></button>
          </div>
        : replyingTo && <div className="reply-banner">
            <Icon name="reply" size={14} />
            <span className="reply-banner-av"><Avatar name={replyingTo.author} url={replyingTo.avatarUrl} size={16} /></span>
            Ответ <b>{replyingTo.author}</b>
            <span>{replyingTo.preview}</span>
            <button type="button" title="Отменить" onClick={() => onCancelReply?.()}><Icon name="close" size={14} /></button>
          </div>}
      {shareBuild && user && <ShareBuildModal hostId={user.id} onClose={() => setShareBuild(false)}
        onShared={(packId: string, manifest: QlManifest, card: ShareCardCustom) => {
          setShareBuild(false)
          const totalMb = Math.round(manifest.mods.reduce((a, m) => a + m.size, 0) / 1024 / 1024)
          onSend(sysQuickLaunch(packId, { game: 'Minecraft', mcVersion: manifest.mcVersion, loader: manifest.loader, modCount: manifest.mods.length, totalMb, ...card }))
        }} />}
      {shareGameLink && user && <ShareGameLinkModal game={shareGameLink} label={gameOf(user?.id ?? '')?.mode ?? null} hostId={user.id} onClose={() => setShareGameLink(false)}
        onShared={(ip, port, card) => {
          const g = gameOf(user?.id ?? '')
          const kind = shareGameLink
          setShareGameLink(false)
          if (kind === 'roblox') {
            if (!g?.placeId) return
            onSend(sysGameLink('roblox', { game: 'Roblox', label: g.mode ?? null, url: robloxJoinUrl(g.placeId, g.jobId), ...card }))
          } else if (kind === 'cs2') {
            // v1.198.0: ip/port тоже кладём в meta — принимающая сторона (MessageList)
            // пересобирает steam://connect сама и проверяет форму адреса, а не доверяет
            // сырому url из содержимого сообщения (которое можно подделать в обход этой формы).
            onSend(sysGameLink('cs2', { game: 'Counter-Strike 2', label: ip + ':' + port, url: steamConnectUrl(ip, port), ip, port, ...card }))
          } else if (kind === 'terraria') {
            onSend(sysGameLink('terraria', { game: 'Terraria', label: ip + ':' + port, ip, port, ...card }))
          }
        }} />}
      {rec && <div className="voice-pill">
        <span className="voice-dot" />
        <b className="voice-time">{Math.floor(rec.t / 60)}:{String(rec.t % 60).padStart(2, '0')}</b>
        <button type="button" className="voice-x" title="Отменить запись" onClick={() => stopRec(false)}><Icon name="close" size={16} /></button>
        <button type="button" className="voice-send" title="Отправить голосовое" onClick={() => stopRec(true)}><Icon name="send" size={16} /></button>
      </div>}
      <form className={'composer cstyle-' + (settings.composerStyle || 'default')} onSubmit={submit}>
        {/* v1.286.0: команды плагинов — отдельным списком над командами ботов, чтобы
            было сразу видно, что это твоё локальное, а не с сервера. */}
        {/* v1.475.0: доводы набираемой команды. Человек видит, что от него
            хотят, прямо в поле ввода — а не гадает после «/опрос». */}
        {активная && состояние && <div className="mention-pop cmdargs-pop">
          <div className="mention-h">
            /{активная.name}{' '}
            {argHint(активная.args!, состояние.current).map(a => (
              <span key={a.name} className={'cmdarg' + (a.on ? ' on' : '') + (a.req ? ' req' : '')}>
                {'<' + a.name + '>'}
              </span>
            ))}
            {текущийДовод?.description && <span className="mut cmdarg-d">{текущийДовод.description}</span>}
          </div>
          {подсказки.map(s => (
            <div key={s.value} className="mention-it"
              onMouseDown={e => { e.preventDefault(); pickArg(s.value) }}>
              {s.label}
              {s.label !== s.value && <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>{s.value}</span>}
            </div>
          ))}
        </div>}
        {pluginCmdSugg.length > 0 && <div className="mention-pop">
          <div className="mention-h">Команды плагинов</div>
          {pluginCmdSugg.map(c => (
            <div key={c.pluginId + ':' + c.name} className="mention-it"
              onMouseDown={e => { e.preventDefault(); setText('/' + c.name + ' '); requestAnimationFrame(() => inputRef.current?.focus()) }}>
              <span className="mention-at">/</span>{c.name}
              <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>{c.description}</span>
            </div>
          ))}
        </div>}
        {cmdSugg.length > 0 && <div className="mention-pop">
          <div className="mention-h">Команды бота</div>
          {cmdSugg.map((c, i) => (
            <div key={c.id} className={'mention-it' + (i === cmdIdx ? ' on' : '')}
              onMouseEnter={() => setCmdIdx(i)}
              onMouseDown={e => { e.preventDefault(); pickCommand(c) }}>
              <span className="mention-at">/</span>{c.name}
              <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>{c.description}</span>
            </div>
          ))}
        </div>}
        {emojiSugg.length > 0 && <div className="mention-pop">
          <div className="mention-h">Эмодзи</div>
          {emojiSugg.map((s, i) => (
            <div key={(s.url ? 'c:' : 'u:') + s.name} className={'mention-it' + (i === eIdx ? ' on' : '')}
              onMouseEnter={() => setEIdx(i)}
              onMouseDown={e => { e.preventDefault(); pickEmoji(s) }}>
              {s.url
                ? <img className="inline-emoji" src={s.url} alt="" />
                : <span style={{ fontSize: 18, lineHeight: '18px' }}>{s.char}</span>}
              <span>{s.name}</span>
              {s.url && <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>свой</span>}
            </div>
          ))}
        </div>}
        {sugg.length > 0 && <div className="mention-pop">
          <div className="mention-h">Упомянуть</div>
          {sugg.map((s, i) => (
            <div key={s.kind + ':' + s.name} className={'mention-it' + (i === mIdx ? ' on' : '')}
              onMouseEnter={() => setMIdx(i)}
              onMouseDown={e => { e.preventDefault(); pickMention(s.name) }}>
              <span className="mention-at" style={s.color ? { color: s.color } : undefined}>@</span>
              <span style={s.color ? { color: s.color } : undefined}>{s.name}</span>
              {s.kind === 'everyone' && <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>все участники</span>}
              {s.kind === 'here' && <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>кто сейчас в сети</span>}
              {s.kind === 'role' && <span className="mut" style={{ marginLeft: 'auto', fontSize: 12 }}>роль</span>}
            </div>
          ))}
        </div>}
        <div className="plus-wrap" style={isEditing ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
          <button type="button" className="attach-btn" title="Прикрепить" onClick={() => setPlusMenu(v => !v)}>
            {/* На телефоне сама кнопка круглая, и «плюс в кружке» дал бы кружок
                в кружке — там нужен голый плюс, как на снимке Discord. */}
            <Icon name={IS_MOBILE ? 'plus' : 'plus-circle'} size={IS_MOBILE ? 24 : 20} /></button>
          {plusMenu && <>
            <div className="plus-overlay" onClick={() => setPlusMenu(false)} />
            <div className="plus-menu">
              {canAttachFiles !== false && <>
              <button type="button" onClick={() => { setPlusMenu(false); photoRef.current?.click() }}><Icon name="image" size={17} /> Фото</button>
              <button type="button" onClick={() => { setPlusMenu(false); fileRef.current?.click() }}><Icon name="paperclip" size={17} /> Файл</button>
              <button type="button" onClick={() => { setPlusMenu(false); folderRef.current?.click() }}><Icon name="folder" size={17} /> Папка</button></>}
              <button type="button" onClick={() => { setPlusMenu(false); startRec() }}><Icon name="mic" size={17} /> Голосовое</button>
              {IS_MOBILE && pluginButtons.map(b => (
                <button key={b.pluginId + ':' + b.key} type="button"
                  onClick={() => { setPlusMenu(false); void invokePlugin(b.pluginId, b.onClick, []) }}>
                  <Icon name={b.icon} size={17} /> {b.tooltip}
                </button>
              ))}
              {isQuicklaunchAvailable() && gameOf(user?.id ?? '')?.name === 'Minecraft (Java)' &&
                <button type="button" onClick={() => { setPlusMenu(false); setShareBuild(true) }}><Icon name="gamepad" size={17} /> Поделиться игрой</button>}
              {isQuicklaunchAvailable() && gameOf(user?.id ?? '')?.name === 'Roblox' && !!gameOf(user?.id ?? '')?.placeId &&
                <button type="button" onClick={() => { setPlusMenu(false); setShareGameLink('roblox') }}><Icon name="gamepad" size={17} /> Поделиться игрой</button>}
              {isQuicklaunchAvailable() && gameOf(user?.id ?? '')?.name === 'Counter-Strike 2' &&
                <button type="button" onClick={() => { setPlusMenu(false); setShareGameLink('cs2') }}><Icon name="gamepad" size={17} /> Поделиться игрой</button>}
              {isQuicklaunchAvailable() && gameOf(user?.id ?? '')?.name === 'Terraria' &&
                <button type="button" onClick={() => { setPlusMenu(false); setShareGameLink('terraria') }}><Icon name="gamepad" size={17} /> Поделиться игрой</button>}
            </div>
          </>}
        </div>
        <input ref={fileRef} type="file" hidden multiple onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <input ref={photoRef} type="file" accept="image/*" hidden multiple onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
        <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '' } as any)} onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; sendFiles(fs) }} />
        {/* v1.503.0: поле ввода лежит в своей обёртке — на телефоне именно она
            рисует «таблетку», а смайлик стоит ВНУТРИ неё справа, как в Discord.
            На компьютере обёртка ничего не рисует и ничего не меняет. */}
        <div className="composer-field">
        <textarea ref={inputRef} rows={1} disabled={cmdBusy}
          // Курсор поставили сюда — значит человек работает с этим чатом, и
          // сообщения плагинов должны уходить именно в него.
          onFocus={() => claimCtx(true)}
          placeholder={cmdBusy ? 'Бот отвечает…' : files.length === 1 ? files[0].name : files.length > 1 ? 'Вложений: ' + files.length : placeholder} value={text}
          onChange={e => { const v = e.target.value; setText(v); keepDraft(v); if (v.trim()) onType?.(); if (emoji) setEmoji(false); if (gif) setGif(false); updateMention(v, e.target.selectionStart) }}
          onPaste={e => {
            const pf = Array.from(e.clipboardData?.files ?? [])
            if (pf.length) { e.preventDefault(); addFiles(pf); return }
            // Вставленный текст очищаем от пробелов по краям.
            const p = e.clipboardData?.getData('text')
            if (p && p !== p.trim()) {
              e.preventDefault()
              const el = e.target as HTMLTextAreaElement
              const s = el.selectionStart ?? text.length, en = el.selectionEnd ?? s
              const ins = p.trim()
              const nv = text.slice(0, s) + ins + text.slice(en)
              setText(nv); keepDraft(nv); updateMention(nv, s + ins.length)
              requestAnimationFrame(() => { const c = s + ins.length; el.setSelectionRange(c, c) })
            }
          }}
          onClick={e => updateMention(text, (e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={e => {
            // Ctrl+B — жирный, Ctrl+I — курсив, Ctrl+E — код, Ctrl+Shift+S — спойлер.
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
              const k = e.key.toLowerCase()
              if (k === 'b') { e.preventDefault(); wrapFormat('**'); return }
              if (k === 'i') { e.preventDefault(); wrapFormat('*'); return }
              if (k === 'e') { e.preventDefault(); wrapFormat('`'); return }
              if (e.shiftKey && k === 's') { e.preventDefault(); wrapFormat('||'); return }
            }
            if (cmdSugg.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCmdIdx(i => (i + 1) % cmdSugg.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCmdIdx(i => (i - 1 + cmdSugg.length) % cmdSugg.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickCommand(cmdSugg[Math.min(cmdIdx, cmdSugg.length - 1)]); return }
              if (e.key === 'Escape') { e.preventDefault(); setText(''); return }
            }
            if (emojiSugg.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setEIdx(i => (i + 1) % emojiSugg.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setEIdx(i => (i - 1 + emojiSugg.length) % emojiSugg.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickEmoji(emojiSugg[eIdx]); return }
              if (e.key === 'Escape') { e.preventDefault(); setEQ(null); return }
            }
            if (sugg.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMIdx(i => (i + 1) % sugg.length); return }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMIdx(i => (i - 1 + sugg.length) % sugg.length); return }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(sugg[mIdx].name); return }
              if (e.key === 'Escape') { e.preventDefault(); setMQ(null); return }
            }
            // v1.358.0: с Alt стрелка принадлежит переключению каналов (ServerView),
            // иначе на пустом поле срабатывало и то и другое разом.
            if (e.key === 'ArrowUp' && !e.altKey && !text && !isEditing) { e.preventDefault(); window.dispatchEvent(new Event('ponoi-edit-last')); return }
            if (e.key === 'Escape') { setEmoji(false); setGif(false); if (isEditing) onCancelEdit?.(); else onCancelReply?.(); return }
            if (e.key === 'Enter') {
              // v1.484.0: решает одна функция (lib/sendKey.ts), а не набор
              // условий здесь. На телефоне обычный Enter больше НЕ отправляет:
              // при вставке из буфера и автозамене экранная клавиатура шлёт
              // такое же событие, и сообщение уходило само — владелец принёс
              // это как «вставляешь, а оно сразу отправляется».
              const отправить = shouldSend({
                ctrl: e.ctrlKey || e.metaKey,
                shift: e.shiftKey,
                // Набор ещё идёт: подтверждение слова выглядит как Enter.
                composing: (e.nativeEvent as any)?.isComposing === true
                  || (e.nativeEvent as any)?.keyCode === 229,
                mobile: IS_MOBILE,
                sendKey: settings.sendKey === 'ctrl' ? 'ctrl' : 'enter',
              })
              if (отправить) { e.preventDefault(); submit(e as any) }
              // Иначе — перенос строки: поведение textarea по умолчанию.
            }
          }} />
        {IS_MOBILE && <button ref={emojiBtn} type="button" className="cin-emoji" title="Эмодзи"
          onPointerDown={keepFocus}
          onClick={() => { setEmoji(v => !v); setGif(false) }}><Icon name="smile" size={20} /></button>}
        </div>
        {text.length > MAXLEN - 200 && <span className={'char-count' + (text.length > MAXLEN ? ' over' : '')}>{MAXLEN - text.length}</span>}
        <div className="composer-tools">
          {!IS_MOBILE && !isEditing && canAttachFiles !== false && <button type="button" className="ctool ctool-clip" title="Прикрепить файл" onClick={() => fileRef.current?.click()}><Icon name="paperclip" size={20} /></button>}
          {!IS_MOBILE && <button ref={emojiBtn} type="button" className="ctool" title="Эмодзи" onClick={() => { setEmoji(v => !v); setGif(false) }}><Icon name="smile" size={20} /></button>}
          {!IS_MOBILE && !isEditing && <button ref={gifBtn} type="button" className="ctool gif-badge" title="GIF, стикеры и эмодзи" onClick={() => { setGif(g => !g); setEmoji(false) }}><span className="gif-badge-oval"><i>G</i><i>I</i><i>F</i></span></button>}
          {!IS_MOBILE && !isEditing && <button type="button" className={'ctool' + (rec ? ' rec-on' : '')} title="Голосовое сообщение" onClick={() => rec ? stopRec(true) : startRec()}><Icon name="mic" size={20} /></button>}
          {/* v1.286.0: кнопки плагинов. Рисуются нашим же компонентом с нашей иконкой —
              плагин задаёт только имя иконки и подсказку, поэтому подделать чужой
              элемент интерфейса (например, поле ввода пароля) он не может. */}
          {/* На телефоне кнопки плагинов уехали в меню плюса: в строке ввода их
              не видно, но доступны они по-прежнему все. */}
          {!IS_MOBILE && !isEditing && pluginButtons.map(b => (
            <button key={b.pluginId + ':' + b.key} type="button" className="ctool" title={b.tooltip}
              onClick={() => { void invokePlugin(b.pluginId, b.onClick, []) }}>
              <Icon name={b.icon} size={20} />
            </button>
          ))}
          {/* v1.460.0: обе панели закрываются щелчком мимо и Escape — раньше
              только повторным нажатием на тот же значок или крестиком внутри. */}
          {emoji && <Popover className="pop-anchor" trigger={emojiBtn.current} onClose={() => setEmoji(false)}>
            {/* v1.528.0: на телефоне у шторки есть ряд вкладок — с эмодзи можно
                перейти к гифкам и стикерам, не закрывая её. На компьютере
                панели остаются раздельными: там у каждой своя кнопка. */}
            <EmojiPicker onPick={insertEmoji} onClose={() => setEmoji(false)}
              onGifTab={IS_MOBILE ? () => { setEmoji(false); setGif(true) } : undefined} />
          </Popover>}
          {gif && <Popover className="pop-anchor" trigger={gifBtn.current} onClose={() => setGif(false)}>
            <GifPicker onPick={sendGif} onPickSticker={sendSticker} onClose={() => setGif(false)} onEmojiTab={() => { setGif(false); setEmoji(true) }} />
          </Popover>}
        </div>
        {/* v1.503.0: справа ОДНА кнопка, а не две.
            Владелец прислал два снимка мобильного Discord: пустое поле — там
            микрофон, набрал текст — на его месте синяя «отправить», и переход
            между ними анимацией. У нас до этого висели обе сразу.
            Обе кнопки остаются в разметке и лежат друг на друге: показывается
            та, что нужна. Подменять их условием нельзя — снятый и заново
            вставленный элемент не с чем сплавлять, и никакого перехода бы не
            вышло, была бы подмена рывком. */}
        {!busy && <div className={'cin-act' + (hasContent ? ' on' : '') + (IS_MOBILE && !isEditing ? '' : ' solo')}>
          {/* v1.510.0: клавиатура на телефоне не закрывается от этих кнопок —
              фокус остаётся в поле, как в Discord и Telegram. */}
          {IS_MOBILE && !isEditing &&
            <button type="button" className={'cin-mic' + (rec ? ' rec-on' : '')} title="Голосовое сообщение"
              onPointerDown={keepFocus}
              onClick={() => rec ? stopRec(true) : startRec()}><Icon name="mic" size={20} /></button>}
          <button type="submit" className="send-tg" onPointerDown={keepFocus}
            title={isEditing ? 'Сохранить (Enter)' : 'Отправить'}><Icon name={isEditing ? 'check' : 'send'} size={18} /></button>
        </div>}
        {busy && <button type="submit" className="send-busy" disabled>…</button>}
      </form>
    </>
  )
}

type AttachMetaItem = { name?: string; desc?: string } | null

// v1.157.0: «Изменить вложение» — карандаш на краю фото/текстового файла при
// наведении; спойлер/название/описание. Модалка общая для обоих типов.
function AttachEditModal({ initial, onSave, onClose }: {
  initial: { spoiler: boolean; name: string; desc: string }
  onSave: (patch: AttachPatch) => void | Promise<void>
  onClose: () => void
}) {
  const [spoiler, setSpoiler] = useState(initial.spoiler)
  const [name, setName] = useState(initial.name)
  const [desc, setDesc] = useState(initial.desc)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  async function save() {
    setBusy(true)
    try { await onSave({ spoiler, name, desc }); onClose() }
    finally { setBusy(false) }
  }
  return createPortal(
    <div className="att-edit-ov" onClick={onClose}>
      <div className="att-edit-box" onClick={e => e.stopPropagation()}>
        <div className="att-edit-h">Изменить вложение</div>
        <div className="cset-row" style={{ marginTop: 0 }}>
          <div><div className="cset-row-t">Спойлер</div><div className="cset-hint">Размывает вложение, пока не нажмут «показать»</div></div>
          <button type="button" className={'tgl' + (spoiler ? ' on' : '')} onClick={() => setSpoiler(v => !v)} />
        </div>
        <label className="modal-lbl">Название файла</label>
        <input className="modal-in" value={name} onChange={e => setName(e.target.value)} placeholder="По умолчанию" maxLength={100} />
        <label className="modal-lbl">Описание</label>
        <textarea className="cset-topic" style={{ minHeight: 60 }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Необязательно" maxLength={300} />
        <div className="modal-foot">
          <button className="modal-ghost" onClick={onClose}>Отмена</button>
          <button className="modal-primary" disabled={busy} onClick={save}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function Attachment({ url, type, meta, editable, attachMeta, attachIndex, onEditAttachment, uploading, progress, pendingNames }: {
  url?: string | null; type?: string | null; meta?: import('./Lightbox').LightboxMeta
  editable?: boolean
  attachMeta?: AttachMetaItem[] | null
  attachIndex?: number
  onEditAttachment?: (index: number, patch: AttachPatch) => void | Promise<void>
  // v1.185.0: сообщение уже отправлено (как в Discord) — вложение ещё грузится
  // на сервер в фоне, url/type пока локальный blob: (см. sendMsg в ServerView/DMHome).
  uploading?: boolean
  progress?: number
  pendingNames?: string[]
}) {
  const [revealed, setRevealed] = useState(false)
  const [viewer, setViewer] = useState(false)
  const [size, setSize] = useState<string | null>(null)
  // v1.529.0: размер держим и числом. Строка «47,8 МБ» годится для подписи, а
  // карточке архива нужен байтовый размер: по нему она просит у сервера хвост
  // файла, где лежит опись. Считать его обратно из строки — верный способ
  // ошибиться на округлении.
  const [bytes, setBytes] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  // v1.380.0: почему именно картинка не открылась.
  //
  // Раньше на любой сбой писалось одно «Не удалось загрузить изображение», и
  // дальше упереться было не во что: файла нет? нет доступа? загрузился пустым?
  // сеть? Для человека это одинаково выглядит как «приложение сломалось», а
  // починить по такому описанию нельзя ничего. Спрашиваем адрес и говорим прямо.
  const [why, setWhy] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const idx = attachIndex ?? 0
  const myMeta = attachMeta?.[idx] ?? null
  const canEdit = !!editable && !!onEditAttachment && !uploading
  // Вес файла для подсказки: лёгкий HEAD-запрос, сам файл не скачивается.
  useEffect(() => {
    if (!url || uploading || type === 'image' || type === 'video' || url.includes('\n')) { setSize(null); setBytes(null); return }
    let on = true
    fetch(url.replace('#spoiler', ''), { method: 'HEAD' })
      .then(r => { const n = Number(r.headers.get('content-length')); if (on && n > 0) { setSize(fmtSize(n)); setBytes(n) } })
      .catch(() => {})
    return () => { on = false }
  }, [url, type, uploading])
  if (!url) return null
  // v1.312.0: адрес вложения задаёт отправитель. Небезопасную схему (javascript: и
  // подобные) не показываем и не открываем вовсе — см. src/lib/safeUrl.ts.
  if (url.split('\n').some(u => !isSafeUrl(u))) {
    return <span className="msg-att-broken"><Icon name="shield" size={16} /> Вложение с недопустимым адресом заблокировано</span>
  }
  // v1.70.0: группа вложений в одном сообщении — url/type склеены через \n.
  if (url.includes('\n')) {
    const urls = url.split('\n')
    const types = (type ?? '').split('\n')
    const imgCount = types.filter(t => t === 'image').length
    return <div className={'att-group' + (imgCount > 1 ? ' grid' : '')}>
      {urls.map((u, i) => <Attachment key={i} url={u} type={types[i] ?? type} meta={meta}
        editable={editable} attachMeta={attachMeta} attachIndex={i} onEditAttachment={onEditAttachment}
        uploading={uploading} progress={progress} pendingNames={pendingNames ? [pendingNames[i]] : undefined} />)}
    </div>
  }
  const clean = url.replace('#spoiler', '')

  /**
   * Выяснить, почему картинка не открылась, и сказать это словами.
   *
   * Спрашиваем сам адрес: браузер про <img> сообщает только «не вышло», а вот
   * запрос отвечает кодом и размером — по ним и видно, чего не хватает.
   */
  async function explainFail(u: string) {
    setFailed(true)
    try {
      const r = await fetch(u, { method: 'GET' })
      if (r.status === 404) { setWhy('Файла нет на сервере — загрузка не доехала'); return }
      if (r.status === 403 || r.status === 401) { setWhy('Нет доступа к файлу (' + r.status + ')'); return }
      if (!r.ok) { setWhy('Сервер ответил ' + r.status); return }
      const blob = await r.blob()
      if (blob.size === 0) { setWhy('Файл пустой — загрузился 0 байт'); return }
      if (!blob.type.startsWith('image/')) {
        setWhy('Это не картинка: ' + (blob.type || 'тип не указан'))
        return
      }
      setWhy('Файл на месте, но браузер его не показал — возможно, повреждён')
    } catch {
      setWhy('Не достучались до файла — проверь соединение')
    }
  }
  const upOverlay = uploading && <div className="att-upload-ov"><span className="att-spin" />{progress != null && <b>{Math.round(progress * 100)}%</b>}</div>
  // v1.250.0: стикер — крупная картинка БЕЗ рамки/спойлера/лайтбокса вложения
  // (как в Discord: attach_type хранится как 'sticker:<имя>' — второй колонки
  // под название не заводили, имя нужно только для подписи при наведении).
  if (type?.startsWith('sticker')) {
    const name = type.slice('sticker:'.length) || 'стикер'
    return failed ? (
      <a className="msg-att-broken" href={clean} target="_blank" rel="noreferrer" title="Открыть ссылку в браузере">
        <Icon name="image" size={16} /> Не удалось загрузить стикер
      </a>
    ) : <img className="msg-sticker" src={clean} alt={name} title={name} loading="lazy" decoding="async" draggable={false} onDragStart={e => e.preventDefault()} onError={() => void explainFail(clean)} />
  }
  // Голосовое сообщение / аудио — встроенный плеер (blob: локально играбелен, пока грузится).
  if (type === 'audio') return <audio className="msg-audio" controls preload="metadata" src={clean} />
  // v1.185.0: непонятно, что за файл будет на сервере (blob: без расширения) —
  // пока грузится, единая лёгкая карточка вместо тяжёлого CodeFileCard/HEAD-запроса.
  if (type === 'file' && uploading) return (
    <div className="msg-file uploading"><span className="att-spin" /> {pendingNames?.[0] || 'Загрузка файла…'}</div>
  )
  if (type === 'image') {
    if (failed) return (
      <a className="msg-att-broken" href={clean} target="_blank" rel="noreferrer" title="Открыть ссылку в браузере">
        <Icon name="image" size={16} /> {why ?? 'Не удалось загрузить изображение'}
      </a>
    )
    if (url.includes('#spoiler') && !revealed) return (
      <div className="att-editwrap">
        <div className="att-spoiler" title="Спойлер — нажми, чтобы показать" onClick={() => setRevealed(true)}>
          <img className="msg-att blurred" src={clean} alt="спойлер" loading="lazy" decoding="async" draggable={false} onDragStart={e => e.preventDefault()} onError={() => void explainFail(clean)} />
          <span className="att-spoiler-tag">СПОЙЛЕР</span>
        </div>
        {canEdit && <button className="att-edit-btn" title="Изменить вложение" onClick={e => { e.stopPropagation(); setEditOpen(true) }}><Icon name="edit" size={13} /></button>}
        {editOpen && <AttachEditModal initial={{ spoiler: true, name: myMeta?.name ?? '', desc: myMeta?.desc ?? '' }}
          onSave={patch => onEditAttachment!(idx, patch)} onClose={() => setEditOpen(false)} />}
      </div>
    )
    return <>
      <div className="att-editwrap">
        <img className="msg-att zoomable" src={clean} alt="вложение" loading="lazy" decoding="async" draggable={false} onDragStart={e => e.preventDefault()} onClick={() => !uploading && setViewer(true)} onError={() => void explainFail(clean)} />
        {upOverlay}
        {canEdit && <button className="att-edit-btn" title="Изменить вложение" onClick={e => { e.stopPropagation(); setEditOpen(true) }}><Icon name="edit" size={13} /></button>}
        {editOpen && <AttachEditModal initial={{ spoiler: false, name: myMeta?.name ?? '', desc: myMeta?.desc ?? '' }}
          onSave={patch => onEditAttachment!(idx, patch)} onClose={() => setEditOpen(false)} />}
      </div>
      {myMeta?.desc && <div className="att-desc">{myMeta.desc}</div>}
      {viewer && <Lightbox url={clean} meta={meta} onClose={() => setViewer(false)} />}
    </>
  }
  // v1.153.0: видео проигрывается прямо в чате (как в Discord), не скачивается как файл.
  if (type === 'video') {
    if (failed) return (
      <a className="msg-att-broken" href={clean} target="_blank" rel="noreferrer" title="Открыть ссылку в браузере">
        <Icon name="video" size={16} /> Не удалось загрузить видео
      </a>
    )
    return <div className="att-editwrap"><video className="msg-att msg-att-video" controls preload="metadata" src={clean} onError={() => void explainFail(clean)} />{upOverlay}</div>
  }
  // v1.286.0: .ponoi — карточка плагина с разрешениями и кнопкой установки.
  // Проверяется раньше кода: файл плагина это тоже JS, и без этой ветки он показался
  // бы просто подсвеченным исходником без единого намёка, что его можно поставить.
  if (isPluginFile(clean)) {
    return <div className="att-editwrap"><PluginInstallCard url={clean} sizeLabel={size} />{upOverlay}</div>
  }
  // v1.83.0: txt и файлы с кодом — карточка с подсветкой, 1-в-1 как в Discord.
  if (isCodeFile(clean)) {
    const isSpoiler = url.includes('#spoiler')
    if (isSpoiler && !revealed) return (
      <div className="att-editwrap">
        <div className="att-spoiler att-spoiler-file" title="Спойлер — нажми, чтобы показать" onClick={() => setRevealed(true)}>
          <div className="att-spoiler-blur"><CodeFileCard url={clean} sizeLabel={size} nameOverride={myMeta?.name} /></div>
          <span className="att-spoiler-tag">СПОЙЛЕР</span>
        </div>
        {canEdit && <button className="att-edit-btn" title="Изменить вложение" onClick={e => { e.stopPropagation(); setEditOpen(true) }}><Icon name="edit" size={13} /></button>}
        {editOpen && <AttachEditModal initial={{ spoiler: true, name: myMeta?.name ?? '', desc: myMeta?.desc ?? '' }}
          onSave={patch => onEditAttachment!(idx, patch)} onClose={() => setEditOpen(false)} />}
      </div>
    )
    return <>
      <div className="att-editwrap">
        <CodeFileCard url={clean} sizeLabel={size} nameOverride={myMeta?.name} />
        {canEdit && <button className="att-edit-btn" title="Изменить вложение" onClick={e => { e.stopPropagation(); setEditOpen(true) }}><Icon name="edit" size={13} /></button>}
        {editOpen && <AttachEditModal initial={{ spoiler: false, name: myMeta?.name ?? '', desc: myMeta?.desc ?? '' }}
          onSave={patch => onEditAttachment!(idx, patch)} onClose={() => setEditOpen(false)} />}
      </div>
      {myMeta?.desc && <div className="att-desc">{myMeta.desc}</div>}
    </>
  }
  // v1.384.0: у ссылки не было признака «скачать» и имени. В личке файл лежит на
  // сервере под обезличенным именем, и браузер сохранял его как «…_enc» — без
  // расширения и без намёка на то, чем это было. Настоящее имя приезжает в
  // метаданных вложения (оно ехало внутри зашифрованного ключа).
  // v1.529.0: карточка вместо синей строки «Скачать файл».
  //
  // Раньше про файл было известно ровно два слова и размер: ни имени с
  // расширением, ни типа, ни содержимого. У архива теперь видно и что внутри —
  // опись читается с конца файла, без скачивания (см. lib/zipPeek.ts).
  return <>
    <div className="att-editwrap">
      <FileCard url={clean} name={myMeta?.name} size={bytes} desc={myMeta?.desc} />
      {canEdit && <button className="att-edit-btn" title="Изменить вложение" onClick={e => { e.stopPropagation(); setEditOpen(true) }}><Icon name="edit" size={13} /></button>}
      {editOpen && <AttachEditModal initial={{ spoiler: false, name: myMeta?.name ?? '', desc: myMeta?.desc ?? '' }}
        onSave={patch => onEditAttachment!(idx, patch)} onClose={() => setEditOpen(false)} />}
    </div>
  </>
}
