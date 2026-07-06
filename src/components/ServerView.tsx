import { toastErr, toastOk } from '../lib/toast'
import { confirmUi, promptUi } from '../lib/confirm'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { Server, Channel, Message } from '../types'
import { MeBar } from './MeBar'
import { AvatarWithStatus } from './AvatarWithStatus'
import { Avatar } from './Avatar'
import { usePresence } from '../lib/presence'
import { notifyMessage, msgSound, uiChime } from '../lib/notify'
import { notifModeOf } from '../lib/srvNotify'
import { mentionsUser } from '../lib/md'
import { sendPush } from '../lib/push'
import { MiniProfile, MiniProfileData } from './MiniProfile'
import { Composer } from './Composer'
import { MessageList, jumpToMessage } from './MessageList'
import { GameLine } from './ActivityLabel'
import { PlateBg } from './PlateBg'
import { useUserFonts } from '../lib/userFonts'
import { chNameStyle } from '../lib/chStyle'
import { listMembers, updateServer } from '../lib/servers'
import { CallRoom, Sinks } from './CallRoom'
import { joinRoom, Room, RoomEvent } from '../lib/livekit'
import { fadeInCall, sndJoin, sndLeave, sndMute, sndUnmute } from '../lib/callSounds'
import { loadReactions, toggleReaction, groupReactions, setPin, deleteMessage, editMessage } from '../lib/reactions'
import type { RxSummary } from '../lib/reactions'
import { Icon } from './icons'
import { SearchPanel } from './SearchPanel'
import { useTyping } from '../lib/typing'
import { TypingIndicator } from './TypingIndicator'
import { fetchRoles, fetchMemberRoles, toggleMemberRole, createRole, deleteRole, ROLE_COLORS, type ServerRole } from '../lib/roles'
import { IS_MOBILE, openMobNav, closeMobNav } from '../lib/mobile'
import { sysPin, parseSys } from '../lib/sysmsg'
import { ActivityLabel } from './ActivityLabel'
import { ChannelSettings } from './ChannelSettings'
import { InviteModal } from './InviteModal'
import { CreateChannelModal } from './CreateChannelModal'
import { ServerPrivacyModal, CreateCategoryModal } from './ServerModals'
import { loadChMuted, setChMuted } from '../lib/chMute'
import { ServerEvents } from './ServerEvents'
import { ProfileCard } from './ProfileCard'
import { getMsgs, putMsgs } from '../lib/msgCache'

// v1.103.0: дебаунс перезагрузки реакций — реалтайм-события пачкой дают один запрос вместо десятка.
let svRxDeb: number | undefined

// ---- v1.30.0: голос на сервере как в Discord — без экрана звонка. ----
// Невидимое «подключение»: включает микрофон, играет звуки входа/выхода,
// прокидывает звук участников и сообщает, кто сейчас говорит.
// v1.81.0: каналы как в Discord — эмодзи в начале имени канала выносится
// перед вертикальной чертой: «# 💬 | имя-канала»; каналы объявлений — рупор.
const EMOJI_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*(.+)$/u
function splitEmoji(name: string): { emo: string | null; rest: string } {
  const m = name.match(EMOJI_RE)
  return m ? { emo: m[1], rest: m[2] } : { emo: null, rest: name }
}
// v1.138.0: шрифт названия (серверный ch_font или свой name_font) и раскраска
// (name_colors: 1–4 цвета, name_anim — переливание) — см. src/lib/chStyle.ts.
function ChName({ c, srv }: { c: Channel; srv?: any }) {
  const ann = !!(c as any).settings?.announce
  const icon = (c as any).kind === 'voice' ? 'volume' : ann ? 'megaphone' : 'hash'
  const s = splitEmoji(c.name)
  const cs = chNameStyle((c as any).settings, srv)
  return <span className="ch-nm"><Icon name={icon} size={18} />{s.emo && <><span className="ch-emo">{s.emo}</span><span className="ch-vbar" /></>}<span className={'ch-txt' + (cs.grad ? ' ch-grad' : '') + (cs.anim ? ' ch-grad-anim' : '')} style={cs.style}>{s.rest}</span></span>
}

function VoiceConn({ room, onSpeak, sinks }: { room: Room; onSpeak: (ids: string[]) => void; sinks: boolean }) {
  useEffect(() => {
    room.localParticipant.setMicrophoneEnabled(true).catch(() => {})
    fadeInCall()
    const onJoin = () => sndJoin()
    const onGone = () => sndLeave()
    const onSpk = (sp: any[]) => onSpeak(sp.map(p => String(p.identity)))
    room.on(RoomEvent.ParticipantConnected, onJoin)
    room.on(RoomEvent.ParticipantDisconnected, onGone)
    room.on(RoomEvent.ActiveSpeakersChanged, onSpk)
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin)
      room.off(RoomEvent.ParticipantDisconnected, onGone)
      room.off(RoomEvent.ActiveSpeakersChanged, onSpk)
    }
    // eslint-disable-next-line
  }, [room])
  // v1.130.0: когда открыта панель голосового канала, звук воспроизводит её
  // собственный <Sinks> — здесь глушим свой, чтобы не было двойного звука.
  return sinks ? <Sinks room={room} /> : null
}

export function ServerView({ server, username, avatarUrl, onAvatar, onLeft }:
  { server: Server; username: string; avatarUrl?: string | null; onAvatar?: (u: string) => void; onLeft: () => void }) {
  const { user } = useAuth()
  const [channels, setChannels] = useState<Channel[]>([])
  const [curChannel, setCurChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [members, setMembers] = useState<any[]>([])
  const memberFonts = useUserFonts(members.map(z => z.user_id))  // v1.112.0: шрифты ников в списке участников
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgsBoxRef = useRef<HTMLDivElement>(null)
  const prevLen = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  // Голосовое подключение (v1.30.0): комната LiveKit + канал, без экрана звонка.
  const [voice, setVoice] = useState<{ room: Room; ch: Channel } | null>(null)
  const voiceRef = useRef<{ room: Room; ch: Channel } | null>(null)
  const [vMic, setVMic] = useState(true)
  const [voicePanel, setVoicePanel] = useState(false)   // v1.130.0: панель голосового канала (как в Discord)
  const [connecting, setConnecting] = useState<Channel | null>(null)   // v1.142.0: канал, к которому идёт подключение — панель и аватар показываем сразу, LiveKit коннектится в фоне
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({})
  const [voiceUsers, setVoiceUsers] = useState<Record<string, { userId: string; username: string; avatar?: string | null; live?: boolean }[]>>({})
  const voicePresRef = useRef<any>(null)
  const joinSeq = useRef(0)   // v1.142.0: поздно завершившийся коннект не должен перебить более свежий вход/выход
  const isOwner = server.owner === user?.id
  const { statusOf, activityOf, gameOf, deviceOf } = usePresence()
  const [mini, setMini] = useState<MiniProfileData | null>(null)
  const [roles, setRoles] = useState<ServerRole[]>([])
  const [memberRoles, setMemberRoles] = useState<Record<string, string[]>>({})  // v1.96.0: user_id -> все его роли
  const [rolePop, setRolePop] = useState<{ userId: string; x: number; y: number } | null>(null)
  const [reactions, setReactions] = useState<Record<string, RxSummary[]>>({})
  const [showPins, setShowPins] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showMembers, setShowMembers] = useState(() => IS_MOBILE ? false : localStorage.getItem('ponoi_members_open') !== '0')
  const [catOpen, setCatOpen] = useState(() => localStorage.getItem('ponoi_cat_text_open') !== '0')
  const [voiceCatOpen, setVoiceCatOpen] = useState(() => localStorage.getItem('ponoi_cat_voice_open') !== '0')
  const [srvMenu, setSrvMenu] = useState(false)
  const [showEvents, setShowEvents] = useState(false)
  const [showThreads, setShowThreads] = useState(false)
  const [thrQ, setThrQ] = useState('')
  const [showAllCh, setShowAllCh] = useState(() => localStorage.getItem('ponoi_show_all_channels') === '1')
  const [showCreateCh, setShowCreateCh] = useState<null | { kind: 'text' | 'voice'; cat?: string }>(null)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [showInvite, setShowInvite] = useState(false)   // v1.68.0: панель «Пригласить друзей»
  const [showCreateCat, setShowCreateCat] = useState(false)
  const [srvSettings, setSrvSettings] = useState<any>((server as any).settings ?? {})
  const [mutedCh, setMutedCh] = useState<Record<string, boolean>>(loadChMuted())
  const [chCtx, setChCtx] = useState<{ ch: Channel; x: number; y: number } | null>(null)
  const [catCtx, setCatCtx] = useState<{ cat: any; x: number; y: number } | null>(null)
  const [catOpenMap, setCatOpenMap] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('ponoi_cat_open') ?? '{}') } catch { return {} } })
  const [chSettings, setChSettings] = useState<Channel | null>(null)
  const [editProfile, setEditProfile] = useState(false)
  const [hideMuted, setHideMuted] = useState(() => localStorage.getItem('ponoi_hide_muted') === '1')
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string } | null>(null)
  const [newDividerId, setNewDividerId] = useState<string | null>(null)
  // Подсветка каналов с непрочитанными сообщениями (как в Discord).
  const [unreadCh, setUnreadCh] = useState<Record<string, boolean>>({})
  const curChannelRef = useRef<Channel | null>(null)
  // Память прокрутки по каналам + подгрузка старых сообщений при скролле вверх.
  const pendingScroll = useRef<number | 'bottom' | { unreadId: string } | null>(null)   // v1.108.0: { unreadId } — прыжок к первому непрочитанному
  const loadingOlder = useRef(false)
  const hasMore = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const prevTop = useRef(0)
  const msgsRef = useRef<Message[]>([])
  const { typers, notifyTyping } = useTyping(curChannel?.id ?? null, username)

  // Цветные роли: id -> роль. С v1.96.0 у участника может быть сколько угодно
  // ролей (member_roles); до миграции 25 — старое одиночное server_members.role_id.
  const roleById: Record<string, ServerRole> = {}
  for (const r of roles) roleById[r.id] = r
  function rolesOfId(userId: string): string[] {
    const multi = memberRoles[userId]
    if (multi && multi.length) return multi
    const mm = members.find(z => z.user_id === userId)
    return mm?.role_id ? [mm.role_id] : []
  }
  // Высшая роль (position меньше — выше): её цвет и её секция в списке участников, как в Discord.
  function topRoleOf(m: any): ServerRole | undefined {
    let best: ServerRole | undefined
    for (const id of rolesOfId(m.user_id)) { const r = roleById[id]; if (r && (!best || r.position < best.position)) best = r }
    return best
  }
  // Значок высшей роли со значком (как в Discord: «видят значок высшей из них»).
  function topIconOf(m: any): string | undefined {
    const rs = rolesOfId(m.user_id).map(id => roleById[id]).filter(Boolean).sort((a, b) => a.position - b.position)
    return rs.find(r => r.icon_url)?.icon_url ?? undefined
  }
  function roleColorOf(userId: string): string | undefined {
    const mm = members.find(z => z.user_id === userId)
    return mm ? topRoleOf(mm)?.color : undefined
  }
  // Право на «Настройки сервера»: владелец или любая роль с флагом «Управление сервером».
  const canManage = isOwner || rolesOfId(user?.id ?? '').some(id => roleById[id]?.manage)

  useEffect(() => { voiceRef.current = voice }, [voice])
  // Смена сервера: тихо выходим из голосового канала прошлого сервера.
  useEffect(() => {
    if (voiceRef.current) { try { voiceRef.current.room.disconnect() } catch {} setVoice(null); setSpeaking({}); setVoicePanel(false) }
    loadChannels(); loadMembers(); loadRoles(); setSrvSettings((server as any).settings ?? {}) /* eslint-disable-next-line */
  }, [server.id])

  // Кто сейчас в голосовых каналах: realtime presence-канал сервера, видно всем.
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('voice:' + server.id, { config: { presence: { key: user.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState() as Record<string, any[]>
      const map: Record<string, { userId: string; username: string; avatar?: string | null }[]> = {}
      for (const key of Object.keys(st)) {
        const meta = st[key][0] as any
        if (!meta?.chId) continue
        if (!map[meta.chId]) map[meta.chId] = []
        map[meta.chId].push({ userId: key, username: meta.username, avatar: meta.avatar ?? null, live: !!meta.live })
      }
      setVoiceUsers(map)
    })
    ch.subscribe()
    voicePresRef.current = ch
    return () => { supabase.removeChannel(ch); voicePresRef.current = null }
    // eslint-disable-next-line
  }, [server.id, user?.id])

  // v1.130.0: бейдж «В ЭФИРЕ» — когда включается/выключается демка, обновляем
  // свой presence-флаг live, чтобы его видели все участники сервера (даже вне канала).
  useEffect(() => {
    if (!voice) return
    const room = voice.room
    const retrack = () => {
      const live = !!(room.localParticipant as any).isScreenShareEnabled
      voicePresRef.current?.track({ chId: voice.ch.id, username, avatar: avatarUrl ?? null, live })
    }
    const evs = [RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished] as any[]
    evs.forEach(e => room.on(e, retrack))
    return () => { evs.forEach(e => room.off(e, retrack)) }
    // eslint-disable-next-line
  }, [voice])

  // При размонтировании выходим из голоса.
  // eslint-disable-next-line
  useEffect(() => () => { try { voiceRef.current?.room.disconnect() } catch {} }, [])

  async function loadMembers() { setMembers(await listMembers(server.id)) }
  async function loadRoles() { setRoles(await fetchRoles(server.id)); setMemberRoles(await fetchMemberRoles(server.id)) }

  async function loadChannels() {
    const { data } = await supabase.from('channels').select('*').eq('server_id', server.id).order('name')
    const list = data ?? []
    setChannels(list)
    // Первым выбираем текстовый канал (голосовые не открываются как чат).
    const texts = list.filter(c => (c as any).kind !== 'voice')
    if (texts.length) selectChannel(texts[0])
    else if (list.length) selectChannel(list[0])
    else { setCurChannel(null); setMessages([]) }
    refreshUnread(list)
  }

  // Начальное вычисление непрочитанных: берём последнее сообщение каждого канала.
  async function refreshUnread(list: Channel[]) {
    if (!list.length) return
    const { data } = await supabase.from('messages').select('channel_id, author, created_at')
      .in('channel_id', list.map(c => c.id)).order('created_at', { ascending: false }).limit(200)
    const seen = new Set<string>()
    const un: Record<string, boolean> = {}
    for (const m of (data ?? []) as any[]) {
      if (seen.has(m.channel_id)) continue
      seen.add(m.channel_id)
      if (loadChMuted()[m.channel_id]) continue
      const lastRead = Number(localStorage.getItem('ponoi_lastread_' + m.channel_id) ?? 0)
      if (m.author !== user?.id && new Date(m.created_at).getTime() > lastRead) un[m.channel_id] = true
    }
    setUnreadCh(un)
  }

  async function selectChannel(c: Channel) {
    setCurChannel(c); closeMobNav()
    setVoicePanel(false)   // v1.133.0: текстовый канал возвращает чат, голос остаётся подключён
    // Сброс случайного выделения текста при переключении канала.
    window.getSelection()?.removeAllRanges()
    setUnreadCh(u => { if (!u[c.id]) return u; const n = { ...u }; delete n[c.id]; return n })
    // v1.103.0: мгновенное открытие — если канал уже открывали, лента появляется сразу
    // из кэша, а сеть освежает её в фоне.
    const cachedList = getMsgs('ch_' + c.id)
    if (cachedList?.length) {
      const lr0 = Number(localStorage.getItem('ponoi_lastread_' + c.id) ?? 0)
      // v1.108.0: как в Discord — есть непрочитанное, сразу прыгаем к нему (к разделителю «НОВОЕ»).
      // v1.111.0: непрочитанного нет — всегда вниз к последним. Восстановление старой позиции
      // убрано: scrollTop, записанный при другой высоте ленты, кидал в самый верх к старым.
      const firstNew0 = lr0 ? (cachedList as Message[]).find(m => m.author !== user?.id && new Date(m.created_at).getTime() > lr0) : undefined
      // v1.136.0: вход в канал ВСЕГДА проматывает в самый низ (как просил пользователь);
      // разделитель «НОВОЕ» остаётся в ленте — до него можно доскроллить вручную.
      pendingScroll.current = 'bottom'
      if (firstNew0) setNewDividerId(firstNew0.id)
      setMessages(cachedList as Message[])
    }
    // Загружаем последние 100 сообщений (раньше в длинных каналах грузились самые старые 100).
    const { data } = await supabase.from('messages').select('*')
      .eq('channel_id', c.id).order('created_at', { ascending: false }).limit(100)
    const list = (data ?? []).reverse()
    hasMore.current = (data ?? []).length === 100
    const lastRead = Number(localStorage.getItem('ponoi_lastread_' + c.id) ?? 0)
    // Разделитель «НОВОЕ»: первое чужое сообщение после последнего визита в канал.
    const firstNew = lastRead ? list.find(m => m.author !== user?.id && new Date(m.created_at).getTime() > lastRead) : undefined
    // v1.108.0: как в Discord — при входе в канал сразу прыгаем к первому непрочитанному
    // (последнее прочитанное сообщение оказывается прямо над разделителем «НОВОЕ»).
    // v1.111.0: непрочитанного нет — всегда вниз к последним. Восстановление сохранённой
    // позиции убрано: scrollTop, записанный при другой высоте ленты (после подгрузки
    // старых сообщений), при новом входе указывал в самый верх, к старым сообщениям.
    // v1.136.0: всегда вниз (разделитель «НОВОЕ» остаётся видимым выше по ленте).
    pendingScroll.current = 'bottom'
    setMessages(list)
    setNewDividerId(firstNew?.id ?? null)
    localStorage.setItem('ponoi_lastread_' + c.id, String(Date.now()))
    loadRx(list.map(m => m.id))
  }

  useEffect(() => {
    if (!curChannel) return
    const ch = supabase.channel('messages:' + curChannel.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => {
          const msg = p.new as Message
          setMessages(m => mergeIncoming(m, msg))
          localStorage.setItem('ponoi_lastread_' + curChannel.id, String(Date.now()))
          if (msg.author !== user?.id && !parseSys(msg.content)) {
            const mode = notifModeOf(server.id)
            const mentioned = !!msg.content && mentionsUser(msg.content, username)
            if (!loadChMuted()[curChannel.id] && (mode === 'all' || (mode === 'mentions' && mentioned))) {
              msgSound()
              notifyMessage(msg.author_name + ' \u2014 #' + curChannel.name, msg.content ?? '')
            }
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => { const msg = p.new as Message; setMessages(m => m.map(x => x.id === msg.id ? msg : x)) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  useEffect(() => {
    const el = msgsBoxRef.current
    if (el && prevHeight.current !== null) {
      // Подгрузили старые сообщения — сохраняем видимую позицию без прыжка.
      el.scrollTop = prevTop.current + (el.scrollHeight - prevHeight.current)
      prevHeight.current = null
    } else if (el && pendingScroll.current !== null) {
      // Восстановление позиции при входе в канал: непрочитанное / сохранённая позиция / вниз.
      const ps = pendingScroll.current
      if (typeof ps === 'object' && ps !== null) {
        // v1.108.0: разделитель «НОВОЕ» — у верхнего края окна, как в Discord.
        const tgt = document.getElementById('msg-' + ps.unreadId)
        if (tgt) el.scrollTop += tgt.getBoundingClientRect().top - el.getBoundingClientRect().top - 72
        else el.scrollTop = el.scrollHeight
      } else el.scrollTop = ps === 'bottom' ? el.scrollHeight : ps
      // v1.136.0: одноразового scrollTop мало — вложения/эмбеды дорисовываются после
      // рендера и лента растёт, из-за чего низ «уезжал». Держим низ, как после отправки.
      if (ps === 'bottom') stickToBottom(800)
      pendingScroll.current = null
      setUnseen(0); setAtBottom(nearBottom())
    } else if (nearBottom()) { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setUnseen(0) }
    else setUnseen(u => u + Math.max(0, messages.length - prevLen.current))
    prevLen.current = messages.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  // «К последним ↓»: автоскролл только если пользователь у низа; иначе копим счётчик.
  function nearBottom(): boolean {
    const el = msgsBoxRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }
  function onMsgsScroll() {
    const el = msgsBoxRef.current
    if (el && el.scrollTop < 60) loadOlder()
    const nb = nearBottom()
    setAtBottom(nb)
    if (nb) setUnseen(0)
  }

  // Динамическая подгрузка старых сообщений небольшими порциями при прокрутке вверх.
  async function loadOlder() {
    const el = msgsBoxRef.current
    if (!curChannel || !el || loadingOlder.current || !hasMore.current || msgsRef.current.length === 0) return
    loadingOlder.current = true
    try {
      const oldest = msgsRef.current[0].created_at
      const { data } = await supabase.from('messages').select('*')
        .eq('channel_id', curChannel.id).lt('created_at', oldest)
        .order('created_at', { ascending: false }).limit(50)
      const older = ((data ?? []) as Message[]).reverse()
      hasMore.current = older.length === 50
      if (older.length) {
        prevHeight.current = el.scrollHeight
        prevTop.current = el.scrollTop
        setMessages(m => [...older, ...m])
        loadRx([...older.map(o => o.id), ...msgsRef.current.map(m => m.id)])
      }
    } finally { loadingOlder.current = false }
  }
  function jumpDown() {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setUnseen(0); setAtBottom(true)
  }
  // v1.88.0: «прилипание» к низу после отправки — вложения догружаются после
  // рендера и лента растёт, одноразового скролла не хватает (как в DMHome).
  const stickUntil = useRef(0)
  function stickToBottom(ms = 1500) {
    stickUntil.current = Date.now() + ms
    const step = () => {
      const el = msgsBoxRef.current
      if (!el || Date.now() > stickUntil.current) return
      el.scrollTop = el.scrollHeight
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  useEffect(() => { msgsRef.current = messages }, [messages])
  useEffect(() => { curChannelRef.current = curChannel }, [curChannel])

  // Предупреждение браузера при попытке закрыть вкладку с активным голосом.
  useEffect(() => {
    if (!voice) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [voice])

  // Ctrl+F — поиск по сообщениям (кнопки в панели больше нет, как в Discord-макете).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setShowThreads(false); setShowPins(false); setShowSearch(s => !s) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line
  }, [])

  // Escape закрывает панель закреплённых.
  useEffect(() => {
    if (!showPins) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPins(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showPins])

  // Реалтайм: новое сообщение в другом канале этого сервера зажигает подсветку.
  useEffect(() => {
    if (!channels.length) return
    const ids = new Set(channels.map(c => c.id))
    const ch = supabase.channel('srv-unread:' + server.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' },
        p => {
          const msg = p.new as Message
          if (!ids.has(msg.channel_id) || msg.author === user?.id) return
          if (loadChMuted()[msg.channel_id]) return
          if (curChannelRef.current?.id === msg.channel_id) return
          setUnreadCh(u => u[msg.channel_id] ? u : { ...u, [msg.channel_id]: true })
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels])

  // v1.103.0: кэшируем последние сообщения открытого канала — повторное открытие мгновенно.
  useEffect(() => { if (curChannel && messages.length) putMsgs('ch_' + curChannel.id, messages) }, [messages, curChannel])

  useEffect(() => {
    if (!curChannel) return
    const ch = supabase.channel('rx:' + curChannel.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' },
        () => { window.clearTimeout(svRxDeb); svRxDeb = window.setTimeout(() => loadRx(msgsRef.current.map(m => m.id)), 250) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  async function createChannel(name: string, kind: 'text' | 'voice', priv: boolean, cat?: string, announce?: boolean) {
    // Сначала пробуем с новыми колонками (kind/settings из миграции 16), при ошибке — без них.
    const settings: any = {}
    if (priv) settings.private = true
    if (cat) settings.category = cat
    if (announce) settings.announce = true   // v1.81.0: канал объявлений («рупор», как в Discord)
    let { error } = await supabase.from('channels').insert({ server_id: server.id, name, kind, settings } as any)
    if (error) {
      const r2 = await supabase.from('channels').insert({ server_id: server.id, name })
      if (!r2.error && kind === 'voice') toastErr('Для голосовых каналов примени миграцию supabase/16_channel_settings.sql')
      error = r2.error
    }
    if (error) return toastErr(error.message)
    uiChime() // мягкое звуковое подтверждение создания канала
    loadChannels()
  }

  // Вход в голосовой канал (v1.30.0, как в Discord): никакого экрана звонка —
  // просто подключаемся, появляемся под каналом у всех и в панели над профилем.
  async function joinVoice(c: Channel) {
    if (!user) return
    if (voice?.ch.id === c.id) { setVoicePanel(true); closeMobNav(); return }   // v1.133.0: как в Discord — клик по своему каналу снова открывает его вид
    // v1.142.0: вход моментальный — панель голосового канала и твоя аватарка
    // появляются сразу (оптимистично, через presence), а подключение к LiveKit
    // (токен + connect + микрофон) идёт в фоне. Раньше всё это ждали до показа —
    // и канал «залипал» на доли секунды.
    const seq = ++joinSeq.current
    if (voice) { try { voice.room.disconnect() } catch {} }
    setVoice(null)
    setConnecting(c)
    setSpeaking({})
    setVoicePanel(true)
    closeMobNav()
    voicePresRef.current?.track({ chId: c.id, username, avatar: avatarUrl ?? null, live: false })
    try {
      const room = await joinRoom('ch_' + c.id, user.id, username)
      if (joinSeq.current !== seq) { try { room.disconnect() } catch {}; return }   // пользователь уже ушёл/сменил канал
      setVoice({ room, ch: c })
      setVMic(true)
    } catch (e: any) {
      if (joinSeq.current !== seq) return
      toastErr(e.message ?? String(e))
      setVoicePanel(false)
      voicePresRef.current?.untrack()
    } finally {
      if (joinSeq.current === seq) setConnecting(null)
    }
  }

  function leaveVoice() {
    joinSeq.current++   // v1.142.0: отменяем незавершённый вход, если он ещё в процессе
    if (voice) { try { voice.room.disconnect() } catch {} }
    setVoice(null)
    setConnecting(null)
    setVoicePanel(false)
    setSpeaking({})
    voicePresRef.current?.untrack()
  }

  async function toggleVMic() {
    if (!voice) return
    const v = !vMic
    try { await voice.room.localParticipant.setMicrophoneEnabled(v); setVMic(v); v ? sndUnmute() : sndMute() } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  // v1.68.0: вместо копирования кода — панель «Пригласить друзей» как в Discord.
  async function invite() {
    if (!user) return
    setShowInvite(true)
  }

  async function leave() {
    if (!user || isOwner) return
    if (!await confirmUi('Покинуть сервер «' + server.name + '»?', { okText: 'Покинуть' })) return
    await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', user.id)
    onLeft()
  }

  // Персональное заглушение канала (localStorage) — гасит звук/подсветку,
  // а «Скрыть заглушённые каналы» убирает такие каналы из списка.
  function toggleMuteCh(id: string) {
    const next = !mutedCh[id]
    setChMuted(id, next)
    setMutedCh(loadChMuted())
    toastOk(next ? 'Канал заглушен' : 'Уведомления канала включены')
  }
  function markChRead(c: Channel) {
    localStorage.setItem('ponoi_lastread_' + c.id, String(Date.now()))
    setUnreadCh(u => { if (!u[c.id]) return u; const n = { ...u }; delete n[c.id]; return n })
    toastOk('Отмечено прочитанным')
  }
  // Категории каналов: живут в servers.settings.categories (миграция 17),
  // каналы привязываются через channels.settings.category (миграция 16).
  async function createCategory(name: string, priv: boolean) {
    const id = (crypto as any).randomUUID ? crypto.randomUUID() : String(Date.now())
    const next = { ...srvSettings, categories: [...(srvSettings.categories ?? []), { id, name, private: priv }] }
    const { error } = await updateServer(server.id, { settings: next } as any)
    if (error) return toastErr(String(error.message ?? error).includes('settings') ? 'Сначала примени миграцию supabase/17_server_settings.sql в Supabase SQL Editor' : String(error.message ?? error))
    setSrvSettings(next); uiChime(); toastOk('Категория «' + name + '» создана')
  }
  async function deleteCategory(cat: any) {
    if (!await confirmUi('Удалить категорию «' + cat.name + '»? Каналы вернутся в общий список.', { okText: 'Удалить' })) return
    const next = { ...srvSettings, categories: (srvSettings.categories ?? []).filter((c: any) => c.id !== cat.id) }
    const { error } = await updateServer(server.id, { settings: next } as any)
    if (error) return toastErr(String(error.message ?? error))
    setSrvSettings(next)
  }
  async function renameCategory(cat: any) {
    const name = (await promptUi('Название категории', { initial: cat.name, okText: 'Переименовать' }))?.trim()
    if (!name || name === cat.name) return
    const next = { ...srvSettings, categories: (srvSettings.categories ?? []).map((c: any) => c.id === cat.id ? { ...c, name } : c) }
    const { error } = await updateServer(server.id, { settings: next } as any)
    if (error) return toastErr(String(error.message ?? error))
    setSrvSettings(next)
  }
  function toggleCat(id: string) {
    setCatOpenMap(m => { const n = { ...m, [id]: !(m[id] ?? true) }; localStorage.setItem('ponoi_cat_open', JSON.stringify(n)); return n })
  }


  // v1.66.0: мгновенная отправка (как в Discord) — сообщение появляется в ленте
  // сразу, сеть догоняет в фоне; при ошибке черновик убирается с тостом.
  function mergeIncoming(list: Message[], msg: Message): Message[] {
    if (list.some(x => x.id === msg.id)) return list.map(x => x.id === msg.id ? msg : x)
    if (msg.author === user?.id) {
      const ti = list.findIndex(x => (x as any)._tmp && x.content === msg.content)
      if (ti >= 0) { const c = list.slice(); c[ti] = msg; return c }
    }
    return [...list, msg]
  }
  async function sendMsg(t: string, attach?: { url: string; type: string }) {
    if (!curChannel || !user) return
    const tmpId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    const row = {
      channel_id: curChannel.id, author: user.id, author_name: username, content: t,
      attach_url: attach?.url ?? null, attach_type: attach?.type ?? null,
      reply_to: replyTarget?.id ?? null, reply_author: replyTarget?.author ?? null, reply_preview: replyTarget?.preview ?? null,
    }
    setMessages(m => [...m, { ...row, id: tmpId, created_at: new Date().toISOString(), _tmp: true } as any])
    setReplyTarget(null)
    // v1.88.0: после отправки всегда прыгаем вниз к своему сообщению.
    stickToBottom(1200)
    setUnseen(0); setAtBottom(true)
    const chName = curChannel.name
    const targets = members.map(m => m.user_id).filter(id => id !== user.id)
    supabase.from('messages').insert(row).select().single().then(({ data, error }) => {
      if (error || !data) {
        setMessages(m => m.filter(x => x.id !== tmpId))
        toastErr(error?.message ?? 'Не удалось отправить сообщение')
        return
      }
      const real = data as Message
      setMessages(m => m.some(x => x.id === real.id) ? m.filter(x => x.id !== tmpId) : m.map(x => x.id === tmpId ? real : x))
      sendPush(targets, username + ' \u2014 #' + chName, t || 'Вложение', '/')
    })
  }

  async function loadRx(ids: string[]) {
    const rows = await loadReactions('reactions', ids)
    setReactions(groupReactions(rows))
  }
  // v1.66.0: мгновенная реакция — счётчик меняется сразу, сеть догоняет в фоне.
  function optimisticRx(mid: string, emoji: string, uid: string) {
    setReactions(rx => {
      const list = (rx[mid] ?? []).map(s => ({ ...s, users: [...s.users] }))
      const i = list.findIndex(s => s.emoji === emoji)
      if (i >= 0) {
        const s = list[i]; const j = s.users.indexOf(uid)
        if (j >= 0) { s.users.splice(j, 1); s.count-- } else { s.users.push(uid); s.count++ }
        if (s.count <= 0) list.splice(i, 1)
      } else list.push({ emoji, count: 1, users: [uid] })
      return { ...rx, [mid]: list }
    })
  }
  async function react(id: string, emoji: string) {
    if (!user) return
    optimisticRx(id, emoji, user.id)
    await toggleReaction('reactions', id, user.id, emoji)
    loadRx(msgsRef.current.map(m => m.id))
  }
  async function pin(id: string, pinned: boolean) {
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, pinned } as any) : m)))
    await setPin('messages', id, pinned)
    // Системное сообщение в ленте «X закрепил(а) сообщение» (как в Discord).
    if (pinned && user && curChannelRef.current) {
      const target = msgsRef.current.find(m => m.id === id)
      await supabase.from('messages').insert({
        channel_id: curChannelRef.current.id, author: user.id, author_name: username,
        content: sysPin(id, (target?.content || 'вложение').slice(0, 60)),
      })
    }
  }
  async function removeMsg(id: string) {
    if (!await confirmUi('Удалить сообщение?', { okText: 'Удалить' })) return
    setMessages(ms => ms.filter(m => m.id !== id))
    deleteMessage('messages', id)
  }
  async function editMsg(id: string, content: string) {
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, content, edited: true } as any) : m)))
    await editMessage('messages', id, content)
  }

  return (
    <>
      <aside className="channels">
        <div className={'srv-title clickable' + ((server as any).settings?.banner_url ? ' banner' : '')}
          style={(server as any).settings?.banner_url ? { backgroundImage: `linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.35)), url(${(server as any).settings.banner_url})` } : undefined}
          onClick={() => setSrvMenu(v => !v)}>
          <span className="srv-pill">
            <span className="srv-title-nm">{server.name}</span>
            <Icon name={srvMenu ? 'close' : 'chevron-down'} size={14} />
          </span>
          <button className="srv-head-inv" title="Пригласить друзей" onClick={e => { e.stopPropagation(); invite() }}><Icon name="user-plus" size={16} /></button>
        </div>
        {srvMenu && <>
          <div className="ctx-overlay" onClick={() => setSrvMenu(false)} />
          <div className="srv-menu" onClick={() => setSrvMenu(false)}>
            <div className="srv-mi" onClick={invite}><span className="srv-mi-lb">Пригласить на сервер</span> <Icon name="user-plus" size={16} /></div>
            {canManage && <div className="srv-mi" onClick={() => window.dispatchEvent(new CustomEvent('ponoi-open-server-settings', { detail: server }))}><span className="srv-mi-lb">Настройки сервера</span> <Icon name="gear" size={16} /></div>}
            {isOwner && <div className="srv-mi" onClick={() => setShowCreateCh({ kind: 'text' })}><span className="srv-mi-lb">Создать канал</span> <Icon name="plus-circle" size={16} /></div>}
            {isOwner && <div className="srv-mi" onClick={() => setShowCreateCat(true)}><span className="srv-mi-lb">Создать категорию</span> <Icon name="folder" size={16} /></div>}
            {isOwner && <div className="srv-mi" onClick={() => setShowEvents(true)}><span className="srv-mi-lb">Создать событие</span> <Icon name="calendar" size={16} /></div>}
            <div className="srv-msep" />
            {!isOwner && <div className="srv-mi" onClick={e => { e.stopPropagation(); const nv = !showAllCh; setShowAllCh(nv); localStorage.setItem('ponoi_show_all_channels', nv ? '1' : '0') }}><span className="srv-mi-lb">Показать все каналы</span> <span className={'srv-mchk' + (showAllCh ? ' on' : '')}>{showAllCh && <Icon name="check" size={12} />}</span></div>}
            <div className="srv-mi" onClick={() => window.dispatchEvent(new CustomEvent('ponoi-open-server-notif', { detail: server }))}><span className="srv-mi-lb">Параметры уведомлений</span> <Icon name="bell" size={16} /></div>
            <div className="srv-mi" onClick={() => setShowPrivacy(true)}><span className="srv-mi-lb">Настройки конфиденциальности</span> <Icon name="shield" size={16} /></div>
            <div className="srv-msep" />
            <div className="srv-mi" onClick={() => setEditProfile(true)}><span className="srv-mi-lb">Редактировать личный профиль сервера</span> <Icon name="edit" size={16} /></div>
            <div className="srv-mi" onClick={e => { e.stopPropagation(); const nv = !hideMuted; setHideMuted(nv); localStorage.setItem('ponoi_hide_muted', nv ? '1' : '0') }}><span className="srv-mi-lb">Скрыть заглушённые каналы</span> <span className={'srv-mchk' + (hideMuted ? ' on' : '')}>{hideMuted && <Icon name="check" size={12} />}</span></div>
            {!isOwner && <><div className="srv-msep" /><div className="srv-mi danger" onClick={leave}><span className="srv-mi-lb">Покинуть сервер</span> <Icon name="signout" size={16} /></div></>}
            <div className="srv-msep" />
            <div className="srv-mi" onClick={() => { navigator.clipboard?.writeText(server.id); toastOk('ID сервера скопирован') }}><span className="srv-mi-lb">Копировать ID сервера</span> <Icon name="id-card" size={16} /></div>
          </div>
        </>}
        <div className="ch-list">
          {(server as any).settings?.banner_url ? <>
            <div className="ch evt clickable" onClick={() => toastOk('Путеводитель по серверу скоро появится')}><Icon name="flag" size={16} /> Путеводитель по серверу</div>
            <div className="ch evt clickable" onClick={() => { const nv = !showAllCh; setShowAllCh(nv); localStorage.setItem('ponoi_show_all_channels', nv ? '1' : '0') }}><Icon name="list" size={16} /> Каналы и роли</div>
          </> : <>
            <div className="ch evt clickable" onClick={() => setShowEvents(true)}><Icon name="calendar" size={16} /> Мероприятия</div>
          </>}
          <div className="ch-toprows-sep" />
          {(() => {
            const cats: any[] = srvSettings.categories ?? []
            const catIds = new Set(cats.map((c: any) => c.id))
            const catOf = (c: Channel) => { const id = (c as any).settings?.category; return id && catIds.has(id) ? id : null }
            const visible = (c: Channel) => !hideMuted || !mutedCh[c.id] || curChannel?.id === c.id
            const onChCtx = (c: Channel) => (e: React.MouseEvent) => { e.preventDefault(); setChCtx({ ch: c, x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 260) }) }
            const chRow = (c: Channel) => (c as any).kind === 'voice' ? (
              <div key={c.id}>
                <div className={'ch' + (mutedCh[c.id] ? ' muted' : '') + (voice?.ch.id === c.id ? ' on vconn' : '')} onClick={() => joinVoice(c)} onDoubleClick={() => joinVoice(c)} onContextMenu={onChCtx(c)} title={voice?.ch.id === c.id ? 'Нажмите ещё раз — открыть канал' : undefined}>
                  <ChName c={c} srv={srvSettings} />
                  <span className="ch-acts">
                    <button title="Открыть чат" onClick={e => { e.stopPropagation(); toastOk('Чат голосового канала скоро появится') }}><Icon name="message" size={14} /></button>
                    <button title="Пригласить на сервер" onClick={e => { e.stopPropagation(); invite() }}><Icon name="user-plus" size={14} /></button>
                    {isOwner && <button title="Настройки канала" onClick={e => { e.stopPropagation(); setChSettings(c) }}><Icon name="gear" size={14} /></button>}
                  </span>
                </div>
                {(voiceUsers[c.id] ?? []).map(u => (
                  <div key={u.userId} className={'vo' + (speaking[u.userId] ? ' speaking' : '')} title={u.username}>
                    <span className="vo-av"><Avatar name={u.username} url={u.avatar} userId={u.userId} size={20} /></span>
                    <span className="vo-nm">{u.username}</span>
                    {u.live && <span className="vo-live">В ЭФИРЕ</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div key={c.id} className={'ch' + (curChannel?.id === c.id ? ' on' : '') + (unreadCh[c.id] ? ' unread' : '') + (mutedCh[c.id] ? ' muted' : '')}
                onClick={() => selectChannel(c)} onContextMenu={onChCtx(c)}>
                <ChName c={c} srv={srvSettings} />
                <span className="ch-acts">
                  <button title="Пригласить на сервер" onClick={e => { e.stopPropagation(); invite() }}><Icon name="user-plus" size={14} /></button>
                  {isOwner && <button title="Настройки канала" onClick={e => { e.stopPropagation(); setChSettings(c) }}><Icon name="gear" size={14} /></button>}
                </span>
              </div>
            )
            return <>
              <div className="ch-sec clickable" title={catOpen ? 'Свернуть категорию' : 'Развернуть категорию'}
                onClick={() => setCatOpen(v => { localStorage.setItem('ponoi_cat_text_open', v ? '0' : '1'); return !v })}>
                <span className="ch-sec-nm">Текстовые каналы</span><span className="ch-sec-line" /><span className={'ch-caret' + (catOpen ? ' open' : '')}><Icon name="chevron-down" size={12} /></span>
                {isOwner && <button className="ch-sec-add" title="Создать канал" onClick={e => { e.stopPropagation(); setShowCreateCh({ kind: 'text' }) }}><Icon name="plus" size={14} /></button>}
              </div>
              {channels.filter(c => (c as any).kind !== 'voice' && !catOf(c)).filter(c => (catOpen && visible(c)) || curChannel?.id === c.id).map(chRow)}
              <div className="ch-sec clickable" title={voiceCatOpen ? 'Свернуть категорию' : 'Развернуть категорию'}
                onClick={() => setVoiceCatOpen(v => { localStorage.setItem('ponoi_cat_voice_open', v ? '0' : '1'); return !v })}>
                <span className="ch-sec-nm">Голосовые каналы</span><span className="ch-sec-line" /><span className={'ch-caret' + (voiceCatOpen ? ' open' : '')}><Icon name="chevron-down" size={12} /></span>
                {isOwner && <button className="ch-sec-add" title="Создать канал" onClick={e => { e.stopPropagation(); setShowCreateCh({ kind: 'voice' }) }}><Icon name="plus" size={14} /></button>}
              </div>
              {channels.filter(c => (c as any).kind === 'voice' && !catOf(c)).filter(c => voiceCatOpen && visible(c)).map(chRow)}
              {cats.map((cat: any) => {
                const open = catOpenMap[cat.id] ?? true
                return <div key={cat.id}>
                  <div className="ch-sec clickable" title={open ? 'Свернуть категорию' : 'Развернуть категорию'}
                    onClick={() => toggleCat(cat.id)}
                    onContextMenu={e => { if (!isOwner) return; e.preventDefault(); setCatCtx({ cat, x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 200) }) }}>
                    <span className="ch-sec-nm">{cat.private ? '🔒 ' : ''}{cat.name}</span><span className="ch-sec-line" /><span className={'ch-caret' + (open ? ' open' : '')}><Icon name="chevron-down" size={12} /></span>
                    {isOwner && <button className="ch-sec-add" title="Создать канал" onClick={e => { e.stopPropagation(); setShowCreateCh({ kind: 'text', cat: cat.id }) }}><Icon name="plus" size={14} /></button>}
                  </div>
                  {channels.filter(c => catOf(c) === cat.id).filter(c => (open && visible(c)) || curChannel?.id === c.id).map(chRow)}
                </div>
              })}
            </>
          })()}
        </div>
        {(voice || connecting) && <div className="vp">
          <div className="vp-info">
            <div className={'vp-status' + (voice ? '' : ' connecting')}><span className="vp-dot" />{voice ? 'Голос подключён' : 'Подключаемся…'}</div>
            <div className="vp-ch" title={(voice?.ch.name ?? connecting?.name ?? '') + ' / ' + server.name}>{(voice?.ch.name ?? connecting?.name ?? '')} / {server.name}</div>
          </div>
          <div className="vp-btns">
            <button className={'vp-btn' + (vMic ? '' : ' off')} onClick={toggleVMic} disabled={!voice} title={vMic ? 'Выключить микрофон' : 'Включить микрофон'}><Icon name={vMic ? 'mic' : 'mic-off'} size={17} /></button>
            <button className="vp-btn danger" onClick={leaveVoice} title="Отключиться"><Icon name="phone-off" size={17} /></button>
          </div>
        </div>}
        <MeBar username={username} avatarUrl={avatarUrl} onAvatar={onAvatar} />
      </aside>
      <main className={'chat' + ((voice || connecting) && voicePanel ? ' voicemode' : '')}>
        {/* v1.31.0: панель канала 1-в-1 как в Discord — слева # имя, справа ветки / колокольчик / пины / участники. Поиск — Ctrl+F. */}
        <header className="chat-head ph2">
          <button className="mob-burger" onClick={openMobNav} title="Меню"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>
          <span className="ph2-hash">{(voice || connecting) && voicePanel ? <Icon name="volume" size={20} /> : '#'}</span>
          {(() => { const hc: any = voice && voicePanel ? voice.ch : (connecting && voicePanel ? connecting : curChannel); const cs = chNameStyle(hc?.settings, srvSettings); return <span className={'ph2-name' + (cs.grad ? ' ch-grad' : '') + (cs.anim ? ' ch-grad-anim' : '')} style={cs.style}>{hc?.name ?? '—'}</span> })()}
          <div className="ph2-btns">
            <button className={'pin-btn' + (showThreads ? ' on' : '')} title="Ветки" onClick={() => { setShowPins(false); setShowSearch(false); setShowThreads(s => !s) }}><Icon name="threads" size={18} /></button>
            <button className={'pin-btn' + (curChannel && mutedCh[curChannel.id] ? ' on' : '')} title={curChannel && mutedCh[curChannel.id] ? 'Включить уведомления канала' : 'Заглушить канал'} onClick={() => curChannel && toggleMuteCh(curChannel.id)}><Icon name={curChannel && mutedCh[curChannel.id] ? 'bell-off' : 'bell'} size={18} /></button>
            <button className={'pin-btn' + (showPins ? ' on' : '')} title="Закреплённые" onClick={() => { setShowSearch(false); setShowPins(s => !s) }}><Icon name="pin" size={18} />{messages.filter(m => (m as any).pinned).length > 0 && <span className="pin-count">{messages.filter(m => (m as any).pinned).length}</span>}</button>
            <button className={'pin-btn' + (showMembers ? ' on' : '')} title={showMembers ? 'Скрыть участников' : 'Показать участников'}
              onClick={() => setShowMembers(v => { localStorage.setItem('ponoi_members_open', v ? '0' : '1'); return !v })}><Icon name="users" size={18} /></button>
          </div>
        </header>
        {showThreads && <div className="thr-panel">
          <div className="thr-top">
            <span className="thr-t"><Icon name="threads" size={16} /> Ветки</span>
            <input className="thr-in" placeholder="Поиск по названию ветки" value={thrQ} onChange={e => setThrQ(e.target.value)} />
            <button className="thr-create" onClick={() => toastOk('Ветки скоро появятся')}>Создать</button>
          </div>
          <div className="thr-empty">
            <div className="thr-ic"><Icon name="threads" size={24} /></div>
            <b>Нет веток.</b>
            Не отвлекайтесь от беседы с помощью веток — временных текстовых каналов.
          </div>
        </div>}
        {showPins && <div className="pins-panel">
          <div className="pins-h"><Icon name="pin" size={15} /> Закреплённые сообщения</div>
          {messages.filter(m => (m as any).pinned).length === 0 && <div className="mut" style={{ padding: 10, fontSize: 13 }}>Нет закреплённых сообщений</div>}
          {messages.filter(m => (m as any).pinned).map(m => (
            <div key={m.id} className="pin-row clickable" title="Перейти к сообщению" onClick={() => { setShowPins(false); jumpToMessage(m.id) }}><b>{m.author_name}:</b> <span>{m.content}</span>
              <button className="pin-un" title="Открепить" onClick={e => { e.stopPropagation(); pin(m.id, false) }}><Icon name="close" size={14} /></button></div>
          ))}
        </div>}
        {showSearch && <SearchPanel onClose={() => setShowSearch(false)} scope={{
          table: 'messages', channelIds: channels.map(c => c.id),
          channelName: id => channels.find(c => c.id === id)?.name ?? '?',
        }} />}
        {voice && <VoiceConn room={voice.room} sinks={!voicePanel} onSpeak={ids => setSpeaking(Object.fromEntries(ids.map(i => [i, true])))} />}
        {voice && voicePanel && <CallRoom room={voice.room} meId={user?.id ?? ''} meName={username} onLeave={() => { setVoicePanel(false); leaveVoice() }} />}
        {connecting && !voice && voicePanel && <div className="c2-wrap c2-connecting">
          <div className="c2-bubbles"><div className="c2-bub"><div className="c2-bub-av birth"><Avatar name={username} url={avatarUrl} size={84} /></div><div className="c2-bub-nm">{username}</div></div></div>
          <div className="c2-waiting">Подключаемся…</div>
        </div>}
        <div className="msgs" ref={msgsBoxRef} onScroll={onMsgsScroll}>
          {messages.length === 0 && curChannel && <div className="wlc">
            <div className="wlc-title">Добро пожаловать на сервер<br />{server.name}</div>
            <div className="wlc-sub">Это ваш новый сервер. Здесь приведены шаги, которые помогут вам начать с ним работу. Вы можете найти больше советов в нашем руководстве для начинающих.</div>
            <button className="wlc-card" onClick={invite}><span className="wlc-ico">👋</span> Пригласите друзей <Icon name="chevron-right" size={16} /></button>
            {canManage && <button className="wlc-card" onClick={() => window.dispatchEvent(new CustomEvent('ponoi-open-server-settings', { detail: server }))}><span className="wlc-ico">🎨</span> Персонализируйте свой сервер с помощью значка <Icon name="chevron-right" size={16} /></button>}
            <button className="wlc-card" onClick={() => (document.querySelector('main.chat input:not([type="file"])') as HTMLInputElement | null)?.focus()}><span className="wlc-ico">📨</span> Отправьте первое сообщение <Icon name="chevron-right" size={16} /></button>
          </div>}
          <MessageList messages={messages as any} reactions={reactions} currentUser={user?.id} currentUserName={username} newDividerId={newDividerId} ownerId={server.owner}
            nameOf={id => members.find(z => z.user_id === id)?.member_name} colorOf={roleColorOf}
            canPin={m => isOwner || m.author === user?.id} onReact={react} onPin={pin} onDelete={removeMsg}
            onReply={m => setReplyTarget({ id: m.id, author: m.author_name, preview: (m.content || 'вложение').slice(0, 120) })} onEdit={editMsg}
            onMarkUnread={m => { setNewDividerId(m.id); if (curChannelRef.current) localStorage.setItem('ponoi_lastread_' + curChannelRef.current.id, String(new Date(m.created_at).getTime() - 1)) }}
            onProfile={(m, x, y) => { const mm = members.find(z => z.user_id === m.author); const rr = mm ? topRoleOf(mm) : undefined
              setMini({ userId: m.author, name: m.author_name, avatarUrl: mm?.avatar_url ?? null, status: statusOf(m.author), role: mm?.role, roleName: rr?.name, roleColor: rr?.color, activity: activityOf(m.author), x, y }) }} />
          {!atBottom && <button className="jump-down" onClick={jumpDown}>
            {unseen > 0 ? `Новых сообщений: ${unseen}` : 'К последним'} <Icon name="chevron-down" size={14} />
          </button>}
          <div ref={bottomRef} />
        </div>
        <TypingIndicator typers={typers} />
        {curChannel && <Composer placeholder={'Написать в #' + curChannel.name} onSend={sendMsg} draftKey={curChannel.id}
          mentionables={members.map(m => m.member_name).filter(Boolean)}
          replyingTo={replyTarget ? { author: replyTarget.author, preview: replyTarget.preview } : null}
          onCancelReply={() => setReplyTarget(null)} onType={notifyTyping} />}
      </main>
      {showMembers && <aside className="members">
        {(() => {
          const on = members.filter(m => statusOf(m.user_id) !== 'offline')
          const off = members.filter(m => statusOf(m.user_id) === 'offline')
          const row = (m: any) => {
            const act = activityOf(m.user_id)
            const rr = topRoleOf(m)
            const isTyping = typers.includes(m.member_name)
            return (
            <div key={m.user_id} className={'member' + (m.nameplate_outline ? ' plate-outline' : '')}
              style={m.nameplate_outline ? { ['--plate-oc' as any]: m.nameplate_outline } : undefined}
              onContextMenu={e => { if (!isOwner) return; e.preventDefault(); setRolePop({ userId: m.user_id, x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 320) }) }}
              onClick={e => setMini({
              userId: m.user_id, name: m.member_name, avatarUrl: m.avatar_url, status: statusOf(m.user_id),
              role: m.role, roleName: rr?.name, roleColor: rr?.color, activity: act,
              anchor: 'member-list',
              x: Math.min(e.clientX, window.innerWidth - 260), y: e.clientY })}>
              {m.nameplate_url && <PlateBg url={m.nameplate_url} kind={m.nameplate_kind === 'video' ? 'video' : 'image'} />}
              <AvatarWithStatus name={m.member_name} url={m.avatar_url} userId={m.user_id} size={32} status={statusOf(m.user_id)} mobile={deviceOf(m.user_id) === 'mobile'} />
              <span className="me-nm" style={{ color: rr?.color, fontFamily: memberFonts(m.user_id).nick }}>{m.member_name}{(() => { const ic = topIconOf(m); return ic ? <img className="role-badge" src={ic} alt="" title={rr?.name} /> : null })()}
                {(() => { const g = gameOf(m.user_id)
                  if (g) return <GameLine game={g} />
                  return act && <small className="member-act"><ActivityLabel activity={act} /></small> })()}
              </span>
              {isTyping && <span className="member-typing" title="печатает…"><i/><i/><i/></span>}
              {m.role === 'owner' && <span className="mut" title="Владелец"><Icon name="crown" size={14} /></span>}
            </div>
          )}
          // Секции по ролям (v1.33.0, как в Discord): роли в порядке иерархии из настроек,
          // затем «В сети» (без роли), затем все офлайн в «Не в сети».
          const used = new Set<string>()
          const roleSecs = roles.map(r => {
            const list = on.filter(m => !used.has(m.user_id) && topRoleOf(m)?.id === r.id)
            list.forEach(m => used.add(m.user_id))
            return { r, list }
          }).filter(s => s.list.length > 0)
          const rest = on.filter(m => !used.has(m.user_id))
          return <>
            {roleSecs.map(({ r, list }) => <div key={r.id}>
              <div className="dm-sec-t">{r.name} — {list.length}</div>
              {list.map(row)}
            </div>)}
            {rest.length > 0 && <div className="dm-sec-t">Участник — {rest.length}</div>}
            {rest.map(row)}
            {off.length > 0 && <div className="dm-sec-t">Не в сети — {off.length}</div>}
            {off.map(row)}
          </>
        })()}
      </aside>}
      {rolePop && <>
        <div className="ctx-overlay" onClick={() => setRolePop(null)} onContextMenu={e => { e.preventDefault(); setRolePop(null) }} />
        <div className="ctx-menu role-pop" style={{ left: rolePop.x, top: rolePop.y }}>
          <div className="role-pop-h">Роли участника</div>
          {roles.map(r => {
            const on = rolesOfId(rolePop.userId).includes(r.id)
            return <div key={r.id} className={'ctx-item role-item' + (on ? ' on' : '')}
              onClick={async () => { await toggleMemberRole(server.id, rolePop.userId, r.id, !on); await loadRoles(); await loadMembers() }}>
              <span className="role-dot" style={{ background: r.color }} />{r.name}
              {on && <Icon name="check" size={14} />}
              <span className="role-del" title="Удалить роль" onClick={async e => { e.stopPropagation(); if (!await confirmUi('Удалить роль «' + r.name + '»?', { okText: 'Удалить' })) return; await deleteRole(r.id); await Promise.all([loadRoles(), loadMembers()]) }}><Icon name="trash" size={13} /></span>
            </div>
          })}
          {roles.length === 0 && <div className="role-empty">Ролей пока нет</div>}
          <div className="ctx-item" onClick={async () => {
            const name = (await promptUi('Название роли', { placeholder: 'например: Модератор', okText: 'Создать' }))?.trim(); if (!name) return
            const color = ROLE_COLORS[roles.length % ROLE_COLORS.length]
            const { error } = await createRole(server.id, name, color)
            if (error) { toastErr(String(error.message ?? error).includes('server_roles') ? 'Сначала примени миграцию supabase/12_roles.sql в Supabase SQL Editor' : String(error.message ?? error)); return }
            await loadRoles(); toastOk('Роль «' + name + '» создана')
          }}><Icon name="plus" size={14} /> Создать роль</div>
        </div>
      </>}
      {mini && <MiniProfile data={mini} onClose={() => setMini(null)}
        onAddRole={isOwner ? () => { const m = mini; setMini(null); setRolePop({ userId: m.userId, x: Math.min(m.x, window.innerWidth - 240), y: Math.min(m.y, window.innerHeight - 320) }) } : undefined} />}
      {showCreateCh && <CreateChannelModal initialKind={showCreateCh.kind} onClose={() => setShowCreateCh(null)}
        onCreate={(nm, kd, pv, ann) => { const cat = showCreateCh.cat; setShowCreateCh(null); createChannel(nm, kd, pv, cat, ann) }} />}
      {chSettings && <ChannelSettings server={server} channel={chSettings} onClose={() => setChSettings(null)}
        onChanged={() => loadChannels()} onDeleted={() => { setChSettings(null); loadChannels() }} />}
      {showEvents && <ServerEvents server={server} channels={channels} onClose={() => setShowEvents(false)} />}
      {showPrivacy && <ServerPrivacyModal server={server} onClose={() => setShowPrivacy(false)} />}
        {showInvite && user && <InviteModal server={server} channelName={curChannel?.name} meId={user.id} meName={username} onClose={() => setShowInvite(false)} />}
      {showCreateCat && <CreateCategoryModal onClose={() => setShowCreateCat(false)} onCreate={(nm, pv) => { setShowCreateCat(false); createCategory(nm, pv) }} />}
      {chCtx && <>
        <div className="ctx-overlay" onClick={() => setChCtx(null)} onContextMenu={e => { e.preventDefault(); setChCtx(null) }} />
        <div className="ctx-menu" style={{ left: chCtx.x, top: chCtx.y }} onClick={() => setChCtx(null)}>
          <div className="ctx-item" onClick={() => markChRead(chCtx.ch)}><Icon name="check" size={14} /> Пометить как прочитанное</div>
          <div className="ctx-item" onClick={invite}><Icon name="user-plus" size={14} /> Пригласить на сервер</div>
          <div className="ctx-item" onClick={() => toggleMuteCh(chCtx.ch.id)}><Icon name={mutedCh[chCtx.ch.id] ? 'bell' : 'bell-off'} size={14} /> {mutedCh[chCtx.ch.id] ? 'Включить уведомления' : 'Заглушить канал'}</div>
          {isOwner && <div className="ctx-item" onClick={() => setChSettings(chCtx.ch)}><Icon name="gear" size={14} /> Настройки канала</div>}
          <div className="ctx-item" onClick={() => { navigator.clipboard?.writeText(chCtx.ch.id); toastOk('ID канала скопирован') }}><Icon name="id-card" size={14} /> Копировать ID канала</div>
        </div>
      </>}
      {catCtx && <>
        <div className="ctx-overlay" onClick={() => setCatCtx(null)} onContextMenu={e => { e.preventDefault(); setCatCtx(null) }} />
        <div className="ctx-menu" style={{ left: catCtx.x, top: catCtx.y }} onClick={() => setCatCtx(null)}>
          <div className="ctx-item" onClick={() => setShowCreateCh({ kind: 'text', cat: catCtx.cat.id })}><Icon name="plus-circle" size={14} /> Создать канал</div>
          <div className="ctx-item" onClick={() => renameCategory(catCtx.cat)}><Icon name="edit" size={14} /> Переименовать</div>
          <div className="ctx-item danger" onClick={() => deleteCategory(catCtx.cat)}><Icon name="trash" size={14} /> Удалить категорию</div>
        </div>
      </>}
      {editProfile && user && <ProfileCard userId={user.id} name={username} avatarUrl={avatarUrl} status={statusOf(user.id)} onClose={() => setEditProfile(false)} />}
    </>
  )
}
