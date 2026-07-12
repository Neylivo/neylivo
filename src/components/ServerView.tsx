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
import { notifyMessage, msgSound, uiChime, closeNotif } from '../lib/notify'
import { mentionsUser, mentionsRoleName, mentionsHere } from '../lib/md'
import { sendPush } from '../lib/push'
import { MiniProfile, MiniProfileData } from './MiniProfile'
import { Composer } from './Composer'
import { MessageList, jumpToMessage } from './MessageList'
import { GameLine } from './ActivityLabel'
import { PlateBg } from './PlateBg'
import { useUserFonts } from '../lib/userFonts'
import { chNameStyle } from '../lib/chStyle'
import { listMembers, updateServer } from '../lib/servers'
import { uploadWithProgress } from '../lib/storage'
import { isBlockedWith } from '../lib/block'
import { CallRoom, Sinks } from './CallRoom'
import { joinRoom, Room, RoomEvent, DisconnectReason } from '../lib/livekit'
import { fadeInCall, sndJoin, sndLeave, sndMute, sndUnmute } from '../lib/callSounds'
import { loadReactions, toggleReaction, groupReactions, setPin, deleteMessage, editMessage, updateAttachment } from '../lib/reactions'
import type { RxSummary, AttachPatch } from '../lib/reactions'
import { Icon } from './icons'
import { UserTagBadge } from './TagEmoji'
import { SearchPanel } from './SearchPanel'
import { useTyping } from '../lib/typing'
import { TypingIndicator } from './TypingIndicator'
import { fetchRoles, fetchMemberRoles, toggleMemberRole, createRole, deleteRole, ROLE_COLORS, type ServerRole } from '../lib/roles'
import { PERM, hasPerm, kickMember, banMember, timeoutMember } from '../lib/permissions'
import { IS_MOBILE, openMobNav, closeMobNav } from '../lib/mobile'
import { sysPin, parseSys } from '../lib/sysmsg'
import { ActivityLabel } from './ActivityLabel'
import { ChannelSettings } from './ChannelSettings'
import { InviteModal } from './InviteModal'
import { CreateChannelModal } from './CreateChannelModal'
import { ServerPrivacyModal, CreateCategoryModal, ChannelNotifModal } from './ServerModals'
import { chNotifModeOf } from '../lib/chNotify'
import { notifModeOf } from '../lib/srvNotify'
import { useClampToViewport, useFlipSubmenu } from '../lib/clampPos'
import { getChRead, setChRead } from '../lib/userPrefs'
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
  // v1.248.0: раньше «Канал с возрастным ограничением» в ChannelSettings.tsx только
  // сохранял галочку — нигде в списке каналов её не было видно вообще.
  const nsfw = !!(c as any).settings?.nsfw
  return <span className="ch-nm"><Icon name={icon} size={18} />{s.emo && <><span className="ch-emo">{s.emo}</span><span className="ch-vbar" /></>}<span className={'ch-txt' + (cs.grad ? ' ch-grad' : '') + (cs.anim ? ' ch-grad-anim' : '')} style={cs.style}>{s.rest}</span>{nsfw && <span className="ch-nsfw" title="Канал с возрастным ограничением">18+</span>}</span>
}

function VoiceConn({ room, onSpeak, sinks, meName }: { room: Room; onSpeak: (ids: string[]) => void; sinks: boolean; meName?: string }) {
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
  return sinks ? <Sinks room={room} meName={meName} /> : null
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
  // v1.191.0: подменю выбора длительности тайм-аута в rolePop.
  const [timeoutSub, setTimeoutSub] = useState(false)
  useEffect(() => { setTimeoutSub(false) }, [rolePop?.userId])
  // v1.188.0: «+ Добавить роль» в мини-профиле — компактный поиск-попап (как в
  // Discord), отдельно от rolePop выше (тот — полное меню участника по правому клику).
  const [quickRolePop, setQuickRolePop] = useState<{ userId: string; x: number; y: number } | null>(null)
  const [quickRoleQ, setQuickRoleQ] = useState('')
  const [reactions, setReactions] = useState<Record<string, RxSummary[]>>({})
  const [showPins, setShowPins] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  // v1.248.0: канал «с возрастным ограничением» (ChannelSettings.tsx, settings.nsfw)
  // раньше только сохранял галочку и нигде её не использовал. Подтверждение —
  // локальное (устройство), не аккаунт-синк — так же ведёт себя настоящий Discord.
  const [nsfwOk, setNsfwOk] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('ponoi_nsfw_ok') || '[]')) } catch { return new Set() } })
  function confirmNsfw(chId: string) {
    setNsfwOk(s => {
      const next = new Set(s); next.add(chId)
      try { localStorage.setItem('ponoi_nsfw_ok', JSON.stringify(Array.from(next))) } catch {}
      return next
    })
  }
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
  const [, setNotifVer] = useState(0)   // ре-рендер при смене режима уведомлений канала/сервера
  const [notifForCh, setNotifForCh] = useState<Channel | null>(null)
  const [chCtx, setChCtx] = useState<{ ch: Channel; x: number; y: number } | null>(null)
  const [catCtx, setCatCtx] = useState<{ cat: any; x: number; y: number } | null>(null)
  // v1.225.0: реальный размер этих панелек зависит от прав/содержимого (например,
  // rolePop то с подменю тайм-аута, то без) — клампим по факту (см. src/lib/clampPos.ts).
  const rolePopClamp = useClampToViewport(rolePop?.x ?? 0, rolePop?.y ?? 0)
  const quickRolePopClamp = useClampToViewport(quickRolePop?.x ?? 0, quickRolePop?.y ?? 0)
  const timeoutSubClamp = useFlipSubmenu()
  const chCtxClamp = useClampToViewport(chCtx?.x ?? 0, chCtx?.y ?? 0)
  const catCtxClamp = useClampToViewport(catCtx?.x ?? 0, catCtx?.y ?? 0)
  const [catOpenMap, setCatOpenMap] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem('ponoi_cat_open') ?? '{}') } catch { return {} } })
  const [chSettings, setChSettings] = useState<Channel | null>(null)
  const [editProfile, setEditProfile] = useState(false)
  const [hideMuted, setHideMuted] = useState(() => localStorage.getItem('ponoi_hide_muted') === '1')
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string; avatarUrl?: string | null } | null>(null)
  // v1.177.0: редактирование сообщения — текст живёт в композере, как в Discord.
  const [editingMsg, setEditingMsg] = useState<{ id: string; content: string } | null>(null)
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
  // Все роли участника, отсортированы по позиции (старшая первой) — для мини-профиля,
  // где (в отличие от цвета ника/значка) показываются одновременно все роли, как в Discord.
  function allRolesOf(userId: string): ServerRole[] {
    return rolesOfId(userId).map(id => roleById[id]).filter(Boolean).sort((a, b) => a.position - b.position)
  }
  // Значок высшей роли со значком (как в Discord: «видят значок высшей из них»,
  // не обязательно той же роли, что даёт цвет ника — если у самой старшей роли
  // значка нет, берём значок следующей по старшинству, у которой он есть).
  function roleIconOf(userId: string): string | undefined {
    return allRolesOf(userId).find(r => r.icon_url)?.icon_url ?? undefined
  }
  function roleColorOf(userId: string): string | undefined {
    const mm = members.find(z => z.user_id === userId)
    return mm ? topRoleOf(mm)?.color : undefined
  }
  // Битовая маска прав текущего пользователя (сумма прав всех его ролей) — v1.156.0.
  // v1.191.0: + server-wide base_permissions (эквивалент @everyone из Discord —
  // CREATE_INVITE/MENTION_EVERYONE/ADD_REACTIONS/ATTACH_FILES по умолчанию у всех,
  // см. supabase/49_role_perms2.sql) — иначе клиент решит, что участник без явной
  // роли не может прикрепить файл, хотя сервер это разрешит.
  const myPerms = rolesOfId(user?.id ?? '').reduce((m, id) => m | (roleById[id]?.permissions ?? 0), 0) | (server.base_permissions ?? 0)
  // v1.239.0: упоминание ролей (@Название) — цвет для рендера (md.tsx) и список
  // МОИХ ролей, чтобы сообщение с упоминанием одной из них подсвечивалось так же,
  // как личное упоминание.
  const roleColorMap: Record<string, string> = {}
  for (const r of roles) roleColorMap[r.name.toLowerCase()] = r.color
  const myRoleNameList = rolesOfId(user?.id ?? '').map(id => roleById[id]?.name).filter((n): n is string => !!n)
  // v1.243.0: для пуш-уведомлений (send-push) — кого реально упомянул текст: по
  // нику, @everyone/@here и по ролям (участники этой роли). Edge-функция не видит
  // участников/роли сервера напрямую и личные user_prefs других людей ей доверять
  // нельзя читать без этой информации — проще посчитать здесь один раз и передать
  // список id, чем дублировать разбор текста на упоминания в Deno.
  // v1.248.0: @here — только реально СЕЙЧАС онлайн (statusOf), а не все подряд, как
  // @everyone — иначе пуш на телефон получили бы и офлайн-участники, что и есть весь
  // смысл разницы между @everyone и @here в Discord.
  function mentionedUserIds(text: string): string[] {
    if (!text) return []
    const ids = new Set<string>()
    if (/@everyone(?![\p{L}\p{N}_])/u.test(text)) {
      for (const m of members) ids.add(m.user_id)
    } else if (mentionsHere(text)) {
      for (const m of members) { if (statusOf(m.user_id) !== 'offline') ids.add(m.user_id) }
    }
    for (const m of members) { if (mentionsRoleName(text, m.member_name ?? '')) ids.add(m.user_id) }
    for (const r of roles) {
      if (!mentionsRoleName(text, r.name)) continue
      for (const m of members) { if (rolesOfId(m.user_id).includes(r.id)) ids.add(m.user_id) }
    }
    return Array.from(ids)
  }
  // Право на «Настройки сервера»: владелец или любая из административных ролей.
  const canManage = isOwner || hasPerm(myPerms, PERM.MANAGE_SERVER) || hasPerm(myPerms, PERM.MANAGE_ROLES) || hasPerm(myPerms, PERM.MANAGE_CHANNELS)
    || hasPerm(myPerms, PERM.VIEW_AUDIT_LOG) || hasPerm(myPerms, PERM.MANAGE_EMOJI) || hasPerm(myPerms, PERM.MANAGE_EVENTS)
    || hasPerm(myPerms, PERM.MANAGE_WEBHOOKS) || hasPerm(myPerms, PERM.MANAGE_AUTOMOD)
  const canManageChannels = isOwner || hasPerm(myPerms, PERM.MANAGE_CHANNELS)
  const canManageRoles = isOwner || hasPerm(myPerms, PERM.MANAGE_ROLES)
  const canManageMessages = isOwner || hasPerm(myPerms, PERM.MANAGE_MESSAGES)
  const canManageEvents = isOwner || hasPerm(myPerms, PERM.MANAGE_EVENTS) || hasPerm(myPerms, PERM.MANAGE_CHANNELS)
  const canCreateInvite = isOwner || hasPerm(myPerms, PERM.CREATE_INVITE)
  const canAttachFiles = isOwner || hasPerm(myPerms, PERM.ATTACH_FILES)
  const canAddReactions = isOwner || hasPerm(myPerms, PERM.ADD_REACTIONS)
  const canKick = isOwner || hasPerm(myPerms, PERM.KICK_MEMBERS)
  const canBan = isOwner || hasPerm(myPerms, PERM.BAN_MEMBERS)
  const canTimeout = isOwner || hasPerm(myPerms, PERM.TIMEOUT_MEMBERS)
  // Позиция самой старшей роли участника — для иерархии (нельзя кикнуть/забанить ровню или старшего).
  function topPositionOfId(userId: string): number {
    let best = Infinity
    for (const id of rolesOfId(userId)) { const r = roleById[id]; if (r && r.position < best) best = r.position }
    return best
  }

  useEffect(() => { voiceRef.current = voice }, [voice])
  // Смена сервера: тихо выходим из голосового канала прошлого сервера.
  useEffect(() => {
    if (voiceRef.current) { try { voiceRef.current.room.disconnect() } catch {} setVoice(null); setSpeaking({}); setVoicePanel(false) }
    loadChannels(); loadMembers(); loadRoles(); setSrvSettings((server as any).settings ?? {}) /* eslint-disable-next-line */
  }, [server.id])

  // v1.251.0: правки канала (медленный режим, NSFW, имя, тема и т.д. — ChannelSettings.tsx)
  // раньше долетали только тому, кто сам их сохранил (onChanged={() => loadChannels()}) —
  // требует supabase/62_channels_realtime.sql (без неё событий просто не будет, но и
  // не сломается — тихо ничего не обновляет, как раньше). Мержим точечно в channels/
  // curChannel, а не зовём loadChannels() целиком — та ещё и перепрыгивает на первый
  // текстовый канал при каждом вызове, что здесь совсем не нужно.
  useEffect(() => {
    const ch = supabase.channel('channels-live:' + server.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels', filter: 'server_id=eq.' + server.id }, p => {
        if (p.eventType === 'DELETE') {
          const oldId = (p.old as any)?.id
          if (!oldId) return
          setChannels(cs => cs.filter(c => c.id !== oldId))
          return
        }
        const row = p.new as Channel
        setChannels(cs => cs.some(c => c.id === row.id) ? cs.map(c => c.id === row.id ? row : c) : [...cs, row])
        setCurChannel(cc => (cc && cc.id === row.id) ? row : cc)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [server.id])

  // v1.251.0: настройки САМОГО сервера (категории, баннер, описание, уровень
  // проверки, AFK-канал и т.д. — вкладка «Обзор» в ServerSettings.tsx) раньше
  // жили только в srvSettings — локальной копии, взятой один раз при монтировании
  // ([server.id], не [server]) и никогда не переслушиваемой. src/lib/userTag.ts
  // уже подписан на UPDATE servers (миграция 51) — но только ради тега, эта копия
  // была отдельной и оставалась в курсе, только если её сохранил ты сам
  // (ServerSettings.tsx сам вызывает onChanged после своего же сохранения).
  useEffect(() => {
    const ch = supabase.channel('server-live:' + server.id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'servers', filter: 'id=eq.' + server.id }, p => {
        setSrvSettings((p.new as any)?.settings ?? {})
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [server.id])

  // Кто сейчас в голосовых каналах: realtime presence-канал сервера, видно всем.
  useEffect(() => {
    if (!user) return
    const ch = supabase.channel('voice:' + server.id, { config: { presence: { key: user.id } } })
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState() as Record<string, any[]>
      const map: Record<string, { userId: string; username: string; avatar?: string | null; live?: boolean }[]> = {}
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

  // v1.177.0: ↑ в пустом композере — редактировать своё последнее сообщение (как в Discord).
  useEffect(() => {
    const h = () => {
      const mine = [...messages].reverse().find(m => m.author === user?.id && m.content)
      if (mine) { setEditingMsg({ id: mine.id, content: mine.content ?? '' }); setReplyTarget(null) }
    }
    window.addEventListener('ponoi-edit-last', h)
    return () => window.removeEventListener('ponoi-edit-last', h)
  }, [messages, user?.id])

  // v1.176.0: баг — «отключено» слушал только CallRoom (открытая панель звонка);
  // если комната отваливалась сама (сеть, кик, закрытие сервера) со свёрнутой
  // панелью, «подключён» так и оставался висеть — иконка под каналом не гасла.
  // Теперь это ловится независимо от того, открыта ли панель звонка.
  useEffect(() => {
    if (!voice) return
    const room = voice.room
    const onDisc = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) return   // сами вышли — leaveVoice() уже всё почистил
      setVoice(null); setVoicePanel(false); setSpeaking({})
      untrackVoice()
    }
    room.on(RoomEvent.Disconnected, onDisc)
    return () => { room.off(RoomEvent.Disconnected, onDisc) }
  }, [voice])

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
      if (chNotifModeOf(m.channel_id, server.id) === 'mute') continue
      const lastRead = getChRead(m.channel_id)
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
      const lr0 = getChRead(c.id)
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
    const lastRead = getChRead(c.id)
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
    setChRead(c.id, Date.now())
    loadRx(list.map(m => m.id))
  }

  // Диплинк «Скопировать ссылку на сообщение»: Home.tsx уже переключил вид на этот сервер,
  // осталось выбрать канал и (когда лента подгрузится) прыгнуть к самому сообщению.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { channelId: string; messageId?: string } | undefined
      if (!d?.channelId) return
      const ch = channels.find(c => c.id === d.channelId)
      if (ch) selectChannel(ch)
      const mid = d.messageId
      if (!mid) return
      let tries = 0
      const tick = () => {
        if (document.getElementById('msg-' + mid)) { jumpToMessage(mid); return }
        if (++tries < 20) window.setTimeout(tick, 250)
      }
      window.setTimeout(tick, 400)
    }
    window.addEventListener('ponoi-open-channel-msg', h)
    return () => window.removeEventListener('ponoi-open-channel-msg', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels])

  useEffect(() => {
    if (!curChannel) return
    const ch = supabase.channel('messages:' + curChannel.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => {
          const msg = p.new as Message
          setMessages(m => mergeIncoming(m, msg))
          setChRead(curChannel.id, Date.now())
          if (msg.author !== user?.id && !parseSys(msg.content)) {
            // v1.259.0: режим канала может переопределять режим сервера (chNotifModeOf) —
            // раньше заглушение канала и режим all/mentions сервера проверялись отдельно,
            // теперь канал с явным «Все сообщения» звучит, даже если сервер на «упоминаниях».
            const mode = chNotifModeOf(curChannel.id, server.id)
            // v1.242.0: звук/тост «только за упоминания» раньше не срабатывал на упоминание
            // РОЛИ (только личное @ник) — рассинхрон с подсветкой сообщения и бейджем
            // непрочитанного (Home.tsx/MessageList.tsx), которые роль уже учитывали (v1.239.0).
            const mentioned = !!msg.content && (mentionsUser(msg.content, username) || myRoleNameList.some(rn => mentionsRoleName(msg.content!, rn)))
            if (mode === 'all' || (mode === 'mentions' && mentioned)) {
              msgSound()
              notifyMessage(msg.author_name + ' \u2014 #' + curChannel.name, msg.content ?? '', (msg as any).author_avatar, 'ch:' + curChannel.id)
            }
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: 'channel_id=eq.' + curChannel.id },
        p => { const msg = p.new as Message; setMessages(m => m.map(x => x.id === msg.id ? { ...msg, _localId: (x as any)._localId } as any : x)) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [curChannel])

  // v1.199.0: вернулся в приложение — сразу убрать уведомление по этому каналу,
  // не дожидаясь автозакрытия через 8 сек (см. src/lib/notify.ts).
  useEffect(() => {
    if (!curChannel) return
    const onFocus = () => closeNotif('ch:' + curChannel.id)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
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
          if (chNotifModeOf(msg.channel_id, server.id) === 'mute') return
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

  // v1.176.0: untrack() ждёт круговой рейс до presence-канала прежде чем «sync»
  // уберёт твой же бейдж из-под голосового канала — до этого момента твоя
  // аватарка продолжала висеть под каналом, хотя ты уже вышел. Чистим свою
  // запись из voiceUsers сразу же, не дожидаясь round-trip.
  function untrackVoice() {
    voicePresRef.current?.untrack()
    if (!user) return
    setVoiceUsers(prev => {
      let changed = false
      const next: typeof prev = {}
      for (const k of Object.keys(prev)) {
        const filtered = prev[k].filter(u => u.userId !== user.id)
        if (filtered.length !== prev[k].length) changed = true
        next[k] = filtered
      }
      return changed ? next : prev
    })
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
      untrackVoice()
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
    untrackVoice()
  }

  async function toggleVMic() {
    if (!voice) return
    const v = !vMic
    try { await voice.room.localParticipant.setMicrophoneEnabled(v); setVMic(v); v ? sndUnmute() : sndMute() } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  // v1.68.0: вместо копирования кода — панель «Пригласить друзей» как в Discord.
  async function invite() {
    if (!user) return
    if (!canCreateInvite) { toastErr('Нет права создавать приглашения'); return }
    setShowInvite(true)
  }

  async function leave() {
    if (!user || isOwner) return
    if (!await confirmUi('Покинуть сервер «' + server.name + '»?', { okText: 'Покинуть' })) return
    await supabase.from('server_members').delete().eq('server_id', server.id).eq('user_id', user.id)
    onLeft()
  }

  function markChRead(c: Channel) {
    setChRead(c.id, Date.now())
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
  // v1.179.0: замена временного сообщения настоящим (пришедшим по realtime раньше,
  // чем ответ на сам insert) теряла _localId — React видел смену ключа (tmp-id -> id
  // с сервера), размонтировал и заново монтировал узел, анимация появления
  // проигрывалась второй раз подряд («дёргается»). Переносим _localId со старого
  // временного сообщения на новое, чтобы ключ не менялся.
  function mergeIncoming(list: Message[], msg: Message): Message[] {
    if (list.some(x => x.id === msg.id)) return list.map(x => x.id === msg.id ? { ...msg, _localId: (x as any)._localId } as any : x)
    if (msg.author === user?.id) {
      const ti = list.findIndex(x => (x as any)._tmp && x.content === msg.content)
      if (ti >= 0) { const c = list.slice(); c[ti] = { ...msg, _localId: (list[ti] as any)._localId ?? list[ti].id } as any; return c }
    }
    return [...list, msg]
  }
  // v1.185.0: файлы — как в Discord: сообщение появляется в ленте сразу (с
  // локальным blob-превью из Composer), заливка в Storage и запись в БД идут в
  // фоне; до этого момента только визуальный спиннер на самом вложении, никакой
  // блокирующей полосы над композером (см. Composer.submit()/Attachment).
  async function sendMsg(t: string, attach?: { url: string; type: string }, files?: File[]) {
    if (!curChannel || !user) return
    const tmpId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    const row = {
      channel_id: curChannel.id, author: user.id, author_name: username, content: t,
      attach_url: attach?.url ?? null, attach_type: attach?.type ?? null,
      reply_to: replyTarget?.id ?? null, reply_author: replyTarget?.author ?? null, reply_preview: replyTarget?.preview ?? null,
    }
    const uploading = !!files?.length
    setMessages(m => [...m, {
      ...row, id: tmpId, created_at: new Date().toISOString(), _tmp: true,
      ...(uploading ? { _uploading: true, _uploadNames: files!.map(f => f.name) } : {}),
    } as any])
    setReplyTarget(null)
    // v1.88.0: после отправки всегда прыгаем вниз к своему сообщению.
    stickToBottom(1200)
    setUnseen(0); setAtBottom(true)
    const chName = curChannel.name
    const targets = members.map(m => m.user_id).filter(id => id !== user.id)
    const chId = curChannel.id
    const mentioned = mentionedUserIds(t)

    function finalize(finalRow: typeof row) {
      supabase.from('messages').insert(finalRow).select().single().then(({ data, error }) => {
        if (error || !data) {
          setMessages(m => m.filter(x => x.id !== tmpId))
          toastErr(error?.message ?? 'Не удалось отправить сообщение')
          return
        }
        const real = data as Message
        setMessages(m => m.some(x => x.id === real.id) ? m.filter(x => x.id !== tmpId) : m.map(x => x.id === tmpId ? { ...real, _localId: tmpId } as any : x))
        sendPush(targets, username + ' — #' + chName, t || 'Вложение', '/', { kind: 'channel', serverId: server.id, channelId: chId, mentionedUserIds: mentioned })
      })
    }

    if (!uploading) { finalize(row); return }
    try {
      const spoilerFlags = attach!.url.split('\n').map(u => u.includes('#spoiler'))
      const realUrls: string[] = []
      for (let i = 0; i < files!.length; i++) {
        let url = await uploadWithProgress('attachments', user.id, files![i], p => {
          setMessages(m => m.map(x => x.id === tmpId ? { ...x, _upProgress: (i + p) / files!.length } as any : x))
        })
        if (spoilerFlags[i]) url += '#spoiler'
        realUrls.push(url)
      }
      attach!.url.split('\n').forEach(u => { const b = u.replace('#spoiler', ''); if (b.startsWith('blob:')) URL.revokeObjectURL(b) })
      finalize({ ...row, attach_url: realUrls.join('\n') })
    } catch (err: any) {
      setMessages(m => m.filter(x => x.id !== tmpId))
      toastErr(err.message ?? 'Не удалось загрузить файл')
    }
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
    try {
      await toggleReaction('reactions', id, user.id, emoji)
    } catch (err: any) {
      optimisticRx(id, emoji, user.id) // откат — сервер отказал (например, тайм-аут/нет прав)
      toastErr(err?.message ?? 'Не удалось поставить реакцию')
      return
    }
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
  // v1.177.0: сохранение правки из композера — пусто в поле, как и раньше,
  // предлагает удалить сообщение (с подтверждением), а не оставляет его пустым.
  async function saveEditedMsg(text: string) {
    if (!editingMsg) return
    const id = editingMsg.id
    const t = text.trim()
    setEditingMsg(null)
    if (t) await editMsg(id, t)
    else await removeMsg(id)
  }
  // v1.157.0: спойлер/название/описание одного вложения — карандаш на краю фото/текстового файла.
  async function editAttachment(messageId: string, index: number, patch: AttachPatch) {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    try {
      const res = await updateAttachment('messages', msg as any, index, patch)
      if (res) setMessages(ms => ms.map(m => (m.id === messageId ? ({ ...m, attach_url: res.attach_url, attach_meta: res.attach_meta } as any) : m)))
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  // v1.259.0: уведомления канала могут наследоваться от режима сервера (chNotifModeOf) —
  // при переключении режима на этом или другом устройстве надо перерисовать список
  // каналов/колокольчик, а не только тот компонент, где стоит сам переключатель.
  useEffect(() => {
    const h = () => setNotifVer(v => v + 1)
    window.addEventListener('ponoi-notif', h)
    return () => window.removeEventListener('ponoi-notif', h)
  }, [])
  const mutedCh: Record<string, boolean> = {}
  for (const c of channels) mutedCh[c.id] = chNotifModeOf(c.id, server.id) === 'mute'

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
            {canManageChannels && <div className="srv-mi" onClick={() => setShowCreateCh({ kind: 'text' })}><span className="srv-mi-lb">Создать канал</span> <Icon name="plus-circle" size={16} /></div>}
            {canManageChannels && <div className="srv-mi" onClick={() => setShowCreateCat(true)}><span className="srv-mi-lb">Создать категорию</span> <Icon name="folder" size={16} /></div>}
            {canManageChannels && <div className="srv-mi" onClick={() => setShowEvents(true)}><span className="srv-mi-lb">Создать событие</span> <Icon name="calendar" size={16} /></div>}
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
            const onChCtx = (c: Channel) => (e: React.MouseEvent) => { e.preventDefault(); setChCtx({ ch: c, x: e.clientX, y: e.clientY }) }
            const chRow = (c: Channel) => (c as any).kind === 'voice' ? (
              <div key={c.id}>
                <div className={'ch' + (mutedCh[c.id] ? ' muted' : '') + (voice?.ch.id === c.id ? ' on vconn' : curChannel?.id === c.id ? ' on' : '')} onClick={() => joinVoice(c)} onDoubleClick={() => joinVoice(c)} onContextMenu={onChCtx(c)} title={voice?.ch.id === c.id ? 'Нажмите ещё раз — открыть канал' : undefined}>
                  <ChName c={c} srv={srvSettings} />
                  <span className="ch-acts">
                    {/* v1.249.0: чат голосового канала — тот же MessageList/Composer, что
                        и у текстовых, просто с channelId голосового канала (сообщения не
                        различают kind канала на уровне БД/RLS — это была чисто UI-заглушка).
                        Открывает чат, НЕ подключая к самому звонку — как в Discord. */}
                    <button title="Открыть чат" onClick={e => { e.stopPropagation(); selectChannel(c) }}><Icon name="message" size={14} /></button>
                    <button title="Пригласить на сервер" onClick={e => { e.stopPropagation(); invite() }}><Icon name="user-plus" size={14} /></button>
                    {canManageChannels && <button title="Настройки канала" onClick={e => { e.stopPropagation(); setChSettings(c) }}><Icon name="gear" size={14} /></button>}
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
                  {canManageChannels && <button title="Настройки канала" onClick={e => { e.stopPropagation(); setChSettings(c) }}><Icon name="gear" size={14} /></button>}
                </span>
              </div>
            )
            return <>
              <div className="ch-sec clickable" title={catOpen ? 'Свернуть категорию' : 'Развернуть категорию'}
                onClick={() => setCatOpen(v => { localStorage.setItem('ponoi_cat_text_open', v ? '0' : '1'); return !v })}>
                <span className="ch-sec-nm">Текстовые каналы</span><span className="ch-sec-line" /><span className={'ch-caret' + (catOpen ? ' open' : '')}><Icon name="chevron-down" size={12} /></span>
                {canManageChannels && <button className="ch-sec-add" title="Создать канал" onClick={e => { e.stopPropagation(); setShowCreateCh({ kind: 'text' }) }}><Icon name="plus" size={14} /></button>}
              </div>
              {channels.filter(c => (c as any).kind !== 'voice' && !catOf(c)).filter(c => (catOpen && visible(c)) || curChannel?.id === c.id).map(chRow)}
              <div className="ch-sec clickable" title={voiceCatOpen ? 'Свернуть категорию' : 'Развернуть категорию'}
                onClick={() => setVoiceCatOpen(v => { localStorage.setItem('ponoi_cat_voice_open', v ? '0' : '1'); return !v })}>
                <span className="ch-sec-nm">Голосовые каналы</span><span className="ch-sec-line" /><span className={'ch-caret' + (voiceCatOpen ? ' open' : '')}><Icon name="chevron-down" size={12} /></span>
                {canManageChannels && <button className="ch-sec-add" title="Создать канал" onClick={e => { e.stopPropagation(); setShowCreateCh({ kind: 'voice' }) }}><Icon name="plus" size={14} /></button>}
              </div>
              {channels.filter(c => (c as any).kind === 'voice' && !catOf(c)).filter(c => voiceCatOpen && visible(c)).map(chRow)}
              {cats.map((cat: any) => {
                const open = catOpenMap[cat.id] ?? true
                return <div key={cat.id}>
                  <div className="ch-sec clickable" title={open ? 'Свернуть категорию' : 'Развернуть категорию'}
                    onClick={() => toggleCat(cat.id)}
                    onContextMenu={e => { if (!canManageChannels) return; e.preventDefault(); setCatCtx({ cat, x: e.clientX, y: e.clientY }) }}>
                    <span className="ch-sec-nm">{cat.private ? '🔒 ' : ''}{cat.name}</span><span className="ch-sec-line" /><span className={'ch-caret' + (open ? ' open' : '')}><Icon name="chevron-down" size={12} /></span>
                    {canManageChannels && <button className="ch-sec-add" title="Создать канал" onClick={e => { e.stopPropagation(); setShowCreateCh({ kind: 'text', cat: cat.id }) }}><Icon name="plus" size={14} /></button>}
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
          <span className="ph2-hash">{((voice || connecting) && voicePanel) || (curChannel as any)?.kind === 'voice' ? <Icon name="volume" size={20} /> : '#'}</span>
          {(() => { const hc: any = voice && voicePanel ? voice.ch : (connecting && voicePanel ? connecting : curChannel); const cs = chNameStyle(hc?.settings, srvSettings); return <span className={'ph2-name' + (cs.grad ? ' ch-grad' : '') + (cs.anim ? ' ch-grad-anim' : '')} style={cs.style}>{hc?.name ?? '—'}</span> })()}
          <div className="ph2-btns">
            <button className={'pin-btn' + (showThreads ? ' on' : '')} title="Ветки" onClick={() => { setShowPins(false); setShowSearch(false); setShowThreads(s => !s) }}><Icon name="threads" size={18} /></button>
            <button className={'pin-btn' + (curChannel && chNotifModeOf(curChannel.id, server.id) !== notifModeOf(server.id) ? ' on' : '')} title="Уведомления канала" onClick={() => curChannel && setNotifForCh(curChannel)}><Icon name={curChannel && mutedCh[curChannel.id] ? 'bell-off' : 'bell'} size={18} /></button>
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
        {voice && <VoiceConn room={voice.room} sinks={!voicePanel} meName={username} onSpeak={ids => setSpeaking(Object.fromEntries(ids.map(i => [i, true])))} />}
        {voice && voicePanel && <CallRoom room={voice.room} meId={user?.id ?? ''} meName={username} onLeave={() => { setVoicePanel(false); leaveVoice() }}
          onProfile={(userId, name, avatarUrl, x, y) => setMini({ userId, name, avatarUrl: avatarUrl ?? null, status: statusOf(userId), x, y })} />}
        {connecting && !voice && voicePanel && <div className="c2-wrap c2-connecting">
          <div className="c2-bubbles"><div className="c2-bub"><div className="c2-bub-av birth"><Avatar name={username} url={avatarUrl} size={84} /></div><div className="c2-bub-nm">{username}</div></div></div>
          <div className="c2-waiting">Подключаемся…</div>
        </div>}
        {curChannel && (curChannel as any).settings?.nsfw && !nsfwOk.has(curChannel.id) ? (
          <div className="msgs nsfw-gate">
            <div className="nsfw-gate-box">
              <div className="nsfw-gate-ico">🔞</div>
              <div className="nsfw-gate-t">#{curChannel.name} — канал с возрастным ограничением</div>
              <div className="nsfw-gate-d">Здесь может быть контент, не подходящий для всех — обычно из-за наготы, насилия или другого материала для взрослых. Показывать его, только если тебе есть 18 лет.</div>
              <button className="pqs2-btn primary" onClick={() => confirmNsfw(curChannel.id)}>Мне есть 18 лет — показать канал</button>
            </div>
          </div>
        ) : (
        <div className="msgs" ref={msgsBoxRef} onScroll={onMsgsScroll}>
          {messages.length === 0 && curChannel && <div className="wlc">
            <div className="wlc-title">Добро пожаловать на сервер<br />{server.name}</div>
            <div className="wlc-sub">Это ваш новый сервер. Здесь приведены шаги, которые помогут вам начать с ним работу. Вы можете найти больше советов в нашем руководстве для начинающих.</div>
            <button className="wlc-card" onClick={invite}><span className="wlc-ico">👋</span> Пригласите друзей <Icon name="chevron-right" size={16} /></button>
            {canManage && <button className="wlc-card" onClick={() => window.dispatchEvent(new CustomEvent('ponoi-open-server-settings', { detail: server }))}><span className="wlc-ico">🎨</span> Персонализируйте свой сервер с помощью значка <Icon name="chevron-right" size={16} /></button>}
            <button className="wlc-card" onClick={() => (document.querySelector('main.chat .composer textarea') as HTMLTextAreaElement | null)?.focus()}><span className="wlc-ico">📨</span> Отправьте первое сообщение <Icon name="chevron-right" size={16} /></button>
          </div>}
          <MessageList messages={(messages as any).filter((m: any) => !isBlockedWith(m.author))} reactions={reactions} currentUser={user?.id} currentUserName={username} newDividerId={newDividerId} ownerId={server.owner}
            roleColors={roleColorMap} myRoleNames={myRoleNameList}
            linkCtx={curChannel ? { kind: 'server', serverId: server.id, channelId: curChannel.id } : undefined}
            nameOf={id => members.find(z => z.user_id === id)?.member_name} colorOf={roleColorOf} iconOf={roleIconOf}
            canPin={m => isOwner || m.author === user?.id || canManageMessages} canDelete={m => isOwner || m.author === user?.id || canManageMessages}
            onReact={react} canReact={canAddReactions} onPin={pin} onDelete={removeMsg} onEditAttachment={editAttachment}
            onReply={m => { setReplyTarget({ id: m.id, author: m.author_name, preview: (m.content || 'вложение').slice(0, 120), avatarUrl: m.author_avatar }); setEditingMsg(null) }}
            onStartEdit={m => { setEditingMsg({ id: m.id, content: m.content ?? '' }); setReplyTarget(null) }} editingId={editingMsg?.id ?? null}
            onMarkUnread={m => { setNewDividerId(m.id); if (curChannelRef.current) setChRead(curChannelRef.current.id, new Date(m.created_at).getTime() - 1) }}
            onProfile={(m, x, y) => { const mm = members.find(z => z.user_id === m.author)
              setMini({ userId: m.author, name: m.author_name, avatarUrl: mm?.avatar_url ?? null, status: statusOf(m.author), roles: allRolesOf(m.author).map(r => ({ name: r.name, color: r.color })), activity: activityOf(m.author), x, y }) }} />
          {!atBottom && <button className="jump-down" onClick={jumpDown}>
            {unseen > 0 ? `Новых сообщений: ${unseen}` : 'К последним'} <Icon name="chevron-down" size={14} />
          </button>}
          <div ref={bottomRef} />
        </div>
        )}
        <TypingIndicator typers={typers} />
        {curChannel && !((curChannel as any).settings?.nsfw && !nsfwOk.has(curChannel.id)) && <Composer placeholder={'Написать в #' + curChannel.name} onSend={sendMsg} draftKey={curChannel.id}
          serverId={server.id} channelId={curChannel.id}
          canAttachFiles={canAttachFiles} canMentionEveryone={hasPerm(myPerms, PERM.MENTION_EVERYONE) || isOwner}
          canMentionRoles={hasPerm(myPerms, PERM.MENTION_ROLES) || isOwner}
          mentionables={members.map(m => m.member_name).filter(Boolean)}
          mentionableRoles={roles.map(r => ({ name: r.name, color: r.color }))}
          slowMode={(curChannel.settings as any)?.slow}
          replyingTo={replyTarget ? { author: replyTarget.author, preview: replyTarget.preview, avatarUrl: replyTarget.avatarUrl } : null}
          onCancelReply={() => setReplyTarget(null)} onType={notifyTyping}
          editingTarget={editingMsg} onSaveEdit={saveEditedMsg} onCancelEdit={() => setEditingMsg(null)} />}
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
              onContextMenu={e => { if (!(isOwner || canManageRoles || canKick || canBan || m.user_id === user?.id)) return; e.preventDefault(); setRolePop({ userId: m.user_id, x: e.clientX, y: e.clientY }) }}
              onClick={e => setMini({
              userId: m.user_id, name: m.member_name, avatarUrl: m.avatar_url, status: statusOf(m.user_id),
              roles: allRolesOf(m.user_id).map(r => ({ name: r.name, color: r.color })), activity: act,
              anchor: 'member-list',
              x: Math.min(e.clientX, window.innerWidth - 260), y: e.clientY })}>
              {m.nameplate_url && <PlateBg url={m.nameplate_url} kind={m.nameplate_kind === 'video' ? 'video' : 'image'} />}
              <AvatarWithStatus name={m.member_name} url={m.avatar_url} userId={m.user_id} size={32} status={statusOf(m.user_id)} mobile={deviceOf(m.user_id) === 'mobile'} />
              <span className="me-nm" style={{ color: rr?.color, fontFamily: memberFonts(m.user_id).nick }}>{m.member_name}{(() => { const ir = allRolesOf(m.user_id).find(r => r.icon_url); return ir ? <img className="role-badge" src={ir.icon_url!} alt="" title={ir.name} /> : null })()}<UserTagBadge userId={m.user_id} />
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
        <div className="ctx-menu role-pop" ref={rolePopClamp.ref} style={rolePopClamp.style}>
          {rolePop.userId === user?.id && <>
            {/* v1.253.0: свой ник на ЭТОМ сервере — раньше поменять было нельзя вообще
                (member_name писался один раз при вступлении и никогда потом не обновлялся,
                даже сменой обычного ника в настройках аккаунта). */}
            <div className="ctx-item" onClick={async () => {
              setRolePop(null)
              const cur = members.find(m => m.user_id === user?.id)?.member_name ?? username
              const v = await promptUi('Ник на этом сервере (пусто — как обычный ник)', { placeholder: username, initial: cur, okText: 'Сохранить' })
              if (v === null) return
              const trimmed = v.trim()
              const next = trimmed || username
              const { error } = await supabase.from('server_members').update({ member_name: next, nickname_override: !!trimmed }).eq('server_id', server.id).eq('user_id', user!.id)
              if (error) { toastErr(error.message); return }
              await loadMembers()
              toastOk(trimmed ? 'Ник на сервере изменён' : 'Ник на сервере сброшен до обычного')
            }}><Icon name="edit" size={14} /> Изменить ник на сервере</div>
            <div className="ctx-sep" />
          </>}
          {canManageRoles && <>
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
          </>}
          {/* v1.156.0: кик/бан — не себе, не владельцу, и только если моя старшая роль строго выше жертвы. */}
          {(() => {
            const targetOwner = rolePop.userId === server.owner
            const targetSelf = rolePop.userId === user?.id
            const outranks = isOwner || topPositionOfId(user?.id ?? '') < topPositionOfId(rolePop.userId)
            const showKick = canKick && !targetOwner && !targetSelf && outranks
            const showBan = canBan && !targetOwner && !targetSelf && outranks
            const showTimeout = canTimeout && !targetOwner && !targetSelf && outranks
            const targetMember = members.find(m => m.user_id === rolePop.userId)
            const untilRaw = targetMember?.timeout_until as string | undefined
            const isTimedOut = !!untilRaw && new Date(untilRaw).getTime() > Date.now()
            if (!showKick && !showBan && !showTimeout) return null
            const doTimeout = async (ms: number | null) => {
              try {
                await timeoutMember(server.id, rolePop.userId, ms === null ? null : new Date(Date.now() + ms))
                setTimeoutSub(false); setRolePop(null); await loadMembers()
                toastOk(ms === null ? 'Тайм-аут снят' : 'Участник отправлен в тайм-аут')
              } catch (e: any) { toastErr(e.message ?? String(e)) }
            }
            return <>
              {canManageRoles && <div className="ctx-sep" />}
              {showTimeout && !isTimedOut && <div className="ctx-item has-sub" onClick={e => { e.stopPropagation(); setTimeoutSub(v => !v) }}>
                <span>Тайм-аут</span><Icon name="chevron-right" size={14} />
                {timeoutSub && <div className="ctx-menu ctx-submenu" ref={timeoutSubClamp.ref} style={timeoutSubClamp.style} onClick={e => e.stopPropagation()}>
                  <div className="ctx-item" onClick={() => doTimeout(15 * 60000)}><span>15 минут</span></div>
                  <div className="ctx-item" onClick={() => doTimeout(3600000)}><span>1 час</span></div>
                  <div className="ctx-item" onClick={() => doTimeout(8 * 3600000)}><span>8 часов</span></div>
                  <div className="ctx-item" onClick={() => doTimeout(24 * 3600000)}><span>24 часа</span></div>
                  <div className="ctx-item" onClick={() => doTimeout(7 * 24 * 3600000)}><span>7 дней</span></div>
                </div>}
              </div>}
              {showTimeout && isTimedOut && <div className="ctx-item" onClick={() => doTimeout(null)}><span>Снять тайм-аут</span><Icon name="clock" size={14} /></div>}
              {showKick && <div className="ctx-item danger" onClick={async () => {
                if (!await confirmUi('Кикнуть этого участника с сервера?', { okText: 'Кикнуть' })) return
                try { await kickMember(server.id, rolePop.userId); setRolePop(null); await loadMembers(); toastOk('Участник кикнут') }
                catch (e: any) { toastErr(e.message ?? String(e)) }
              }}><Icon name="signout" size={14} /> Кикнуть с сервера</div>}
              {showBan && <div className="ctx-item danger" onClick={async () => {
                if (!await confirmUi('Забанить этого участника? Он не сможет вернуться по приглашению.', { okText: 'Забанить' })) return
                try { await banMember(server.id, rolePop.userId); setRolePop(null); await loadMembers(); toastOk('Участник забанен') }
                catch (e: any) { toastErr(e.message ?? String(e)) }
              }}><Icon name="trash" size={14} /> Забанить</div>}
            </>
          })()}
        </div>
      </>}
      {mini && <MiniProfile data={mini} onClose={() => setMini(null)}
        onAddRole={(isOwner || canManageRoles || canKick || canBan) ? (e) => {
          // v1.189.0: мини-профиль больше не закрывается — попап с ролями открывается
          // рядом с кнопкой, поверх него (как в Discord).
          setQuickRoleQ('')
          setQuickRolePop({ userId: mini!.userId, x: e.clientX, y: e.clientY })
        } : undefined} />}
      {quickRolePop && <>
        <div className="ctx-overlay" onClick={() => setQuickRolePop(null)} onContextMenu={e => { e.preventDefault(); setQuickRolePop(null) }} />
        <div className="ctx-menu role-quickpop" ref={quickRolePopClamp.ref} style={quickRolePopClamp.style}>
          <input className="role-quick-in" autoFocus placeholder="Роль" value={quickRoleQ} onChange={e => setQuickRoleQ(e.target.value)} />
          <div className="role-quick-list">
            {roles.filter(r => r.name.toLowerCase().includes(quickRoleQ.trim().toLowerCase())).map(r => {
              const on = rolesOfId(quickRolePop.userId).includes(r.id)
              return <div key={r.id} className={'role-item role-quick-item' + (on ? ' on' : '')}
                onClick={async () => { await toggleMemberRole(server.id, quickRolePop.userId, r.id, !on); await loadRoles(); await loadMembers() }}>
                <span className="role-dot" style={{ background: r.color }} />{r.name}
                {on && <Icon name="check" size={13} />}
              </div>
            })}
            {roles.length === 0 && <div className="role-empty">Ролей пока нет</div>}
          </div>
        </div>
      </>}
      {showCreateCh && <CreateChannelModal initialKind={showCreateCh.kind} onClose={() => setShowCreateCh(null)}
        onCreate={(nm, kd, pv, ann) => { const cat = showCreateCh.cat; setShowCreateCh(null); createChannel(nm, kd, pv, cat, ann) }} />}
      {chSettings && <ChannelSettings server={server} channel={chSettings} onClose={() => setChSettings(null)}
        onChanged={() => loadChannels()} onDeleted={() => { setChSettings(null); loadChannels() }} />}
      {showEvents && <ServerEvents server={server} channels={channels} canCreate={canManageEvents} onClose={() => setShowEvents(false)} />}
      {showPrivacy && <ServerPrivacyModal server={server} onClose={() => setShowPrivacy(false)} />}
      {notifForCh && <ChannelNotifModal server={server} channel={notifForCh} onClose={() => setNotifForCh(null)} />}
        {showInvite && user && <InviteModal server={server} channelName={curChannel?.name} meId={user.id} meName={username} onClose={() => setShowInvite(false)} />}
      {showCreateCat && <CreateCategoryModal onClose={() => setShowCreateCat(false)} onCreate={(nm, pv) => { setShowCreateCat(false); createCategory(nm, pv) }} />}
      {chCtx && <>
        <div className="ctx-overlay" onClick={() => setChCtx(null)} onContextMenu={e => { e.preventDefault(); setChCtx(null) }} />
        <div className="ctx-menu" ref={chCtxClamp.ref} style={chCtxClamp.style} onClick={() => setChCtx(null)}>
          <div className="ctx-item" onClick={() => markChRead(chCtx.ch)}><Icon name="check" size={14} /> Пометить как прочитанное</div>
          <div className="ctx-item" onClick={invite}><Icon name="user-plus" size={14} /> Пригласить на сервер</div>
          <div className="ctx-item" onClick={() => setNotifForCh(chCtx.ch)}><Icon name={mutedCh[chCtx.ch.id] ? 'bell-off' : 'bell'} size={14} /> Уведомления канала</div>
          {canManageChannels && <div className="ctx-item" onClick={() => setChSettings(chCtx.ch)}><Icon name="gear" size={14} /> Настройки канала</div>}
          <div className="ctx-item" onClick={() => { navigator.clipboard?.writeText(chCtx.ch.id); toastOk('ID канала скопирован') }}><Icon name="id-card" size={14} /> Копировать ID канала</div>
        </div>
      </>}
      {catCtx && <>
        <div className="ctx-overlay" onClick={() => setCatCtx(null)} onContextMenu={e => { e.preventDefault(); setCatCtx(null) }} />
        <div className="ctx-menu" ref={catCtxClamp.ref} style={catCtxClamp.style} onClick={() => setCatCtx(null)}>
          <div className="ctx-item" onClick={() => setShowCreateCh({ kind: 'text', cat: catCtx.cat.id })}><Icon name="plus-circle" size={14} /> Создать канал</div>
          <div className="ctx-item" onClick={() => renameCategory(catCtx.cat)}><Icon name="edit" size={14} /> Переименовать</div>
          <div className="ctx-item danger" onClick={() => deleteCategory(catCtx.cat)}><Icon name="trash" size={14} /> Удалить категорию</div>
        </div>
      </>}
      {editProfile && user && <ProfileCard userId={user.id} name={username} avatarUrl={avatarUrl} status={statusOf(user.id)} onClose={() => setEditProfile(false)} />}
    </>
  )
}
