import { toastErr, toastOk } from '../lib/toast'
import { setActiveDm } from '../lib/badge'
import { confirmUi } from '../lib/confirm'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { FriendRequest, DMMessage, Profile, DMThread } from '../types'
import { searchUsers, sendRequest, respondRequest, openThread, findByUsername } from '../lib/friends'
import { MeBar } from './MeBar'
import { Avatar } from './Avatar'
import { AvatarWithStatus } from './AvatarWithStatus'
import { usePresence, STATUS_LABEL } from '../lib/presence'
import { notifyMessage, msgSound, closeNotif } from '../lib/notify'
import { sendPush } from '../lib/push'
import { Composer } from './Composer'
import { MessageList, jumpToMessage } from './MessageList'
import { CallRoom, Sinks } from './CallRoom'
import { MiniProfile, MiniProfileData } from './MiniProfile'
import { ProfileCard, type ProfileTab } from './ProfileCard'
import { DmProfilePanel } from './DmProfilePanel'
import { joinRoom, Room, RoomEvent } from '../lib/livekit'
import { startRingback, stopRingback, master, sndMute, sndUnmute } from '../lib/callSounds'
import { sysCallStart, sysCallEnded, sysCallMissed, parseSys } from '../lib/sysmsg'
import { loadReactions, toggleReaction, groupReactions, setPin, deleteMessage, editMessage, updateAttachment } from '../lib/reactions'
import type { RxSummary, AttachPatch } from '../lib/reactions'
import { Icon } from './icons'
import { openMobNav, closeMobNav, IS_MOBILE } from '../lib/mobile'
import { useTyping } from '../lib/typing'
import { TypingIndicator } from './TypingIndicator'
import { GameLine, GameInline } from './ActivityLabel'
import { getMsgs, putMsgs, getCachedThreadId, rememberThreadId } from '../lib/msgCache'
import { getDmRead, setDmRead, isDmPinned, isDmClosed, isDmMuted, isDmIgnored, friendNickOf, reopenDm, closeDm } from '../lib/userPrefs'
import { useAvatarOf, avatarOf } from '../lib/avatars'
import { uploadWithProgress } from '../lib/storage'
import { DmCtxMenu } from './DmCtxMenu'
import { isBlockedWith } from '../lib/block'
import type { Server } from '../types'
import { NewConversationModal } from './NewConversationModal'
import { GroupMembersPanel } from './GroupMembersPanel'
import { fetchGroupThreads, fetchGroupMembers, groupDisplayName, type GroupThread } from '../lib/groupDm'

// v1.103.0: дебаунс перезагрузки реакций — реалтайм-события пачкой дают один запрос вместо десятка.
let dmRxDeb: number | undefined

interface Friend { id: string; name: string }

// v1.187.0: помечает сообщения от игнорируемых — MessageList.tsx сворачивает такие в одну строку.
function tagIgnored(list: DMMessage[]): DMMessage[] {
  return list.map(m => ({ ...m, _ignoredAuthor: isDmIgnored(m.author) } as any))
}

export function DMHome({ username, handle, avatarUrl, onAvatar, servers }:
  { username: string; handle?: string; avatarUrl?: string | null; onAvatar?: (u: string) => void; servers?: Server[] }) {
  const { user } = useAuth()
  const meId = user!.id
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [active, setActive] = useState<Friend | null>(null)
  // v1.223.0: групповые беседы (3-10 человек) — activeGroup и active взаимоисключающие
  // (открыта либо обычная ЛС, либо группа). См. src/lib/groupDm.ts.
  const [groups, setGroups] = useState<GroupThread[]>([])
  const [activeGroup, setActiveGroup] = useState<GroupThread | null>(null)
  const [groupMembers, setGroupMembers] = useState<Profile[]>([])
  const [groupNameCache, setGroupNameCache] = useState<Record<string, string>>({})
  const [newConvOpen, setNewConvOpen] = useState(false)
  // v1.168.0: панель профиля собеседника справа — 1-в-1 как в Discord.
  // По умолчанию закрыта (открывается кнопкой в шапке чата).
  const [showProfile, setShowProfile] = useState(false)
  const [fullProfileTab, setFullProfileTab] = useState<ProfileTab | null>(null)
  const activeAvatar = useAvatarOf(active?.id)
  const [threadId, setThreadId] = useState<string | null>(null)
  // v1.100.0: сообщаем модулю бейджа, какой диалог открыт — его входящие кружок не увеличивают.
  useEffect(() => { setActiveDm(threadId); return () => setActiveDm(null) }, [threadId])
  const [messages, setMessages] = useState<DMMessage[]>([])
  // v1.177.0: ↑ в пустом композере — редактировать своё последнее сообщение (как в Discord).
  useEffect(() => {
    const h = () => {
      const mine = [...messages].reverse().find(m => m.author === meId && m.content)
      if (mine) { setEditingMsg({ id: mine.id, content: mine.content ?? '' }); setReplyTarget(null) }
    }
    window.addEventListener('ponoi-edit-last', h)
    return () => window.removeEventListener('ponoi-edit-last', h)
  }, [messages, meId])
  const bottomRef = useRef<HTMLDivElement>(null)
  const msgsBoxRef = useRef<HTMLDivElement>(null)
  const prevLen = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const [call, setCall] = useState<Room | null>(null)
  const [reactions, setReactions] = useState<Record<string, RxSummary[]>>({})
  const [showPins, setShowPins] = useState(false)
  const [tab, setTab] = useState<'online' | 'all' | 'pending' | 'add'>('online')
  const [ffilter, setFfilter] = useState('')
  // v1.51.0: меню «⋯» на строке друга (как в Discord); закрывается кликом мимо
  const [rowMenu, setRowMenu] = useState<string | null>(null)
  useEffect(() => {
    const h = () => setRowMenu(null)
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [])
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [codeMsg, setCodeMsg] = useState('')
  const [codeOk, setCodeOk] = useState(false) // v1.53.0: зелёное/красное сообщение под полем, как в Discord
  const { statusOf, gameOf, deviceOf } = usePresence()
  const msgsRef = useRef<DMMessage[]>([])
  // v1.187.0: правый клик по другу в списке ЛС — меню закреп/мьют/никнейм/блок/etc.
  const [dmCtx, setDmCtx] = useState<{ friend: Friend; x: number; y: number } | null>(null)
  // user_prefs (пин/мьют/никнейм/закрыто/игнор) не React-стейт — этот счётчик просто
  // заставляет компонент перерисоваться, когда DmCtxMenu что-то в них поменял.
  const [prefsTick, setPrefsTick] = useState(0)
  // v1.194.0: то же самое, но правки прилетели с ДРУГОГО устройства (см. realtime
  // в src/lib/userPrefs.ts) — без этого список ЛС не обновлялся бы сам, только
  // после следующего клика/re-render по другой причине.
  useEffect(() => {
    const h = () => setPrefsTick(v => v + 1)
    window.addEventListener('ponoi-uprefs', h)
    return () => window.removeEventListener('ponoi-uprefs', h)
  }, [])
  // «Начать звонок» из контекстного меню (без захода в чат) — сперва открываем
  // чат (threadId приходит асинхронно), затем звоним, как только он готов.
  const pendingCallRef = useRef(false)
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string; avatarUrl?: string | null } | null>(null)
  // v1.177.0: редактирование сообщения — текст живёт в композере, как в Discord.
  const [editingMsg, setEditingMsg] = useState<{ id: string; content: string } | null>(null)
  const { typers, notifyTyping } = useTyping(threadId, username)
  const [mini, setMini] = useState<MiniProfileData | null>(null)
  const [newDividerId, setNewDividerId] = useState<string | null>(null)
  // Память прокрутки по каналам + подгрузка старых сообщений при скролле вверх.
  const scrollMem = useRef<Record<string, number>>({})
  const pendingScroll = useRef<number | 'bottom' | null>(null)
  const loadingOlder = useRef(false)
  const hasMore = useRef(true)
  const prevHeight = useRef<number | null>(null)
  const prevTop = useRef(0)
  // v1.75.0: «прилипание» к низу при открытии чата. Одноразового scrollTop
  // не хватало: картинки/вложения догружаются после рендера, лента растёт —
  // и позиция уезжала от низа. Пока идёт stick-период, каждый кадр держим низ.
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

  // ---- v1.30.0: исходящий звонок как в Discord — «Звоним…» с гудками. ----
  // Собеседнику летит «ring» по его личному realtime-каналу, пока он не ответит,
  // не отклонит или не истекут 32 секунды.
  const ringChRef = useRef<any>(null)
  const ringTimerRef = useRef<number | null>(null)
  const ringDeadlineRef = useRef<number | null>(null)
  const [ringingTo, setRingingTo] = useState<Friend | null>(null)
  const ringingRef = useRef<Friend | null>(null)
  useEffect(() => { ringingRef.current = ringingTo }, [ringingTo])
  const callRef = useRef<Room | null>(null)
  useEffect(() => { callRef.current = call }, [call])

  // ---- v1.43.0: системное сообщение о звонке в ленте + состояние для панели. ----
  // Звонок живёт при навигации (как в Discord): CallRoom показан только в чате
  // звонка, в остальных местах звук держит отдельный <Sinks>, а кнопки панели
  // обрабатывает запасной слушатель ниже.
  const [callThread, setCallThread] = useState<string | null>(null)
  const [callPeer, setCallPeer] = useState<Friend | null>(null)
  // v1.152.0: мгновенный отклик на звонок 1-в-1 — раньше клик по «позвонить»/«принять»
  // не показывал вообще ничего, пока joinRoom() (токен + LiveKit connect) не завершится
  // целиком (полсекунды-секунда тишины). Теперь баннер «Соединение…» появляется сразу,
  // сам путь подключения (joinRoom) при этом не меняется — только визуальный отклик.
  const [connectingThread, setConnectingThread] = useState<string | null>(null)
  const [connectingPeer, setConnectingPeer] = useState<Friend | null>(null)
  const activeRef = useRef<Friend | null>(null)
  useEffect(() => { activeRef.current = active }, [active])
  const callMsgRef = useRef<string | null>(null)
  const callStartRef = useRef(0)
  const answeredRef = useRef(false)
  const [cstate, setCstate] = useState({ mic: true, deaf: false, cam: false, screen: false, connected: false })
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail; if (d) setCstate(d) }
    window.addEventListener('ponoi-call-state', h)
    return () => window.removeEventListener('ponoi-call-state', h)
  }, [])
  const tglCall = (what: string) => window.dispatchEvent(new CustomEvent('ponoi-call-toggle', { detail: { what } }))
  const cstateRef = useRef(cstate)
  useEffect(() => { cstateRef.current = cstate }, [cstate])
  // Итог звонка: «начинает звонок» превращается в длительность или «пропущен».
  function finishCallMsg() {
    const id = callMsgRef.current
    if (!id) return
    callMsgRef.current = null
    const sec = Math.max(1, Math.round((Date.now() - callStartRef.current) / 1000))
    const content = answeredRef.current ? sysCallEnded(sec) : sysCallMissed(sec)
    supabase.from('dm_messages').update({ content }).eq('id', id).then(() => {})
  }

  function endRing(sendCancel: boolean) {
    stopRingback()
    if (ringTimerRef.current) { window.clearInterval(ringTimerRef.current); ringTimerRef.current = null }
    if (ringDeadlineRef.current) { window.clearTimeout(ringDeadlineRef.current); ringDeadlineRef.current = null }
    const ch = ringChRef.current
    if (ch) {
      if (sendCancel) { try { ch.send({ type: 'broadcast', event: 'cancel', payload: { fromId: meId } }) } catch {} }
      window.setTimeout(() => supabase.removeChannel(ch), 600)
      ringChRef.current = null
    }
    setRingingTo(null)
  }

  function hangUp(sendCancel: boolean) {
    endRing(sendCancel)
    try { callRef.current?.disconnect() } catch {}
    finishCallMsg()
    setCall(null)
    setCallThread(null)
    setCallPeer(null)
    window.dispatchEvent(new CustomEvent('ponoi-call-state', { detail: { mic: true, deaf: false, cam: false, screen: false, connected: false } }))
    try { master().gain.value = 1 } catch {}
  }

  async function startCall() {
    if (!threadId || !active || call) return
    setConnectingThread(threadId); setConnectingPeer(active)
    try {
      const room = await joinRoom('dm_' + threadId, meId, username)
      setCall(room)
      setCallThread(threadId)
      setCallPeer(active)
      // Системное сообщение «X начинает звонок.» — по завершении обновится на итог.
      answeredRef.current = false
      callStartRef.current = Date.now()
      try {
        const { data: sm } = await supabase.from('dm_messages')
          .insert({ thread_id: threadId, author: meId, author_name: username, content: sysCallStart() })
          .select().single()
        callMsgRef.current = (sm as any)?.id ?? null
      } catch {}
      // Гудки + повторяем ring, чтобы собеседник точно увидел модалку.
      setRingingTo(active)
      startRingback()
      const payload = { threadId, fromId: meId, fromName: username, fromAvatar: avatarUrl ?? null }
      const ch = supabase.channel('ring:' + active.id)
      ringChRef.current = ch
      ch.subscribe((st: string) => {
        if (st !== 'SUBSCRIBED') return
        ch.send({ type: 'broadcast', event: 'ring', payload })
        ringTimerRef.current = window.setInterval(() => { try { ch.send({ type: 'broadcast', event: 'ring', payload }) } catch {} }, 2500)
      })
      // Не отвечает 32 секунды — вешаем трубку (как в Discord).
      ringDeadlineRef.current = window.setTimeout(() => {
        if (ringingRef.current) { toastErr(ringingRef.current.name + ' не отвечает'); hangUp(true) }
      }, 32000)
    } catch (e: any) { toastErr(e.message ?? String(e)) }
    finally { setConnectingThread(null); setConnectingPeer(null) }
  }

  // v1.187.0: «Начать звонок» из контекстного меню друга — сперва открываем чат
  // (threadId приходит асинхронно, из кэша или сети), звоним, как только он готов.
  useEffect(() => {
    if (pendingCallRef.current && threadId) { pendingCallRef.current = false; startCall() }
    // eslint-disable-next-line
  }, [threadId])

  // Кнопки панели/MeBar работают и когда CallRoom не на экране (другая вкладка/чат).
  const crShownRef = useRef(false)
  useEffect(() => {
    const h = async (e: Event) => {
      if (crShownRef.current) return // CallRoom смонтирован — обработает сам
      const room = callRef.current
      if (!room) return
      const what = (e as CustomEvent).detail?.what
      const st = { ...cstateRef.current }
      try {
        if (what === 'mic') { const v = !st.mic; await room.localParticipant.setMicrophoneEnabled(v); st.mic = v; v ? sndUnmute() : sndMute() }
        else if (what === 'deaf') { st.deaf = !st.deaf; try { master().gain.value = st.deaf ? 0 : 1 } catch {}; st.deaf ? sndMute() : sndUnmute() }
        else if (what === 'cam') { const v = !st.cam; await room.localParticipant.setCameraEnabled(v); st.cam = v }
        else if (what === 'screen') { const v = !st.screen; await (room.localParticipant as any).setScreenShareEnabled(v); st.screen = v }
      } catch (err: any) { toastErr(err.message ?? String(err)) }
      window.dispatchEvent(new CustomEvent('ponoi-call-state', { detail: st }))
    }
    window.addEventListener('ponoi-call-toggle', h)
    return () => window.removeEventListener('ponoi-call-toggle', h)
    // eslint-disable-next-line
  }, [])

  // Собеседник подключился к комнате — гудки больше не нужны.
  useEffect(() => {
    if (!call) return
    const onJoin = () => { answeredRef.current = true; endRing(false) }
    call.on(RoomEvent.ParticipantConnected, onJoin)
    return () => { call.off(RoomEvent.ParticipantConnected, onJoin) }
    // eslint-disable-next-line
  }, [call])

  // ---- v1.80.0: остался один в звонке — авто-завершение через 3 минуты. ----
  // Собеседник вышел: ждём 3 минуты (вдруг вернётся — например, переподключение
  // или случайно закрыл вкладку); если за это время никто не зашёл — вешаем
  // трубку сами, как в Discord. Возврат собеседника отменяет таймер.
  const aloneTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const clear = () => { if (aloneTimerRef.current) { window.clearTimeout(aloneTimerRef.current); aloneTimerRef.current = null } }
    if (!call) { clear(); return }
    const onLeft = () => {
      const n = (call as any).remoteParticipants?.size ?? (call as any).participants?.size ?? 0
      if (n > 0) return
      clear()
      aloneTimerRef.current = window.setTimeout(() => {
        aloneTimerRef.current = null
        if (callRef.current) { toastErr('Звонок завершён — вы остались одни'); hangUp(false) }
      }, 180_000)
    }
    const onBack = () => clear()
    call.on(RoomEvent.ParticipantDisconnected, onLeft)
    call.on(RoomEvent.ParticipantConnected, onBack)
    return () => { clear(); call.off(RoomEvent.ParticipantDisconnected, onLeft); call.off(RoomEvent.ParticipantConnected, onBack) }
    // eslint-disable-next-line
  }, [call])

  // Ответ на исходящий звонок: принял / отклонил (события шлёт глобальный слушатель IncomingCall).
  useEffect(() => {
    const acc = () => endRing(false)
    const dec = () => { if (ringingRef.current) { toastErr(ringingRef.current.name + ' отклонил(а) звонок'); hangUp(false) } }
    window.addEventListener('ponoi-call-accepted', acc)
    window.addEventListener('ponoi-call-declined', dec)
    return () => { window.removeEventListener('ponoi-call-accepted', acc); window.removeEventListener('ponoi-call-declined', dec) }
    // eslint-disable-next-line
  }, [])

  // Принятый входящий звонок: модалка уже открыла нужный ЛС, осталось подключиться.
  useEffect(() => {
    const h = async (e: Event) => {
      const tid = (e as CustomEvent).detail?.threadId
      if (!tid || callRef.current) return
      setConnectingThread(tid); setConnectingPeer(activeRef.current)
      try {
        const room = await joinRoom('dm_' + tid, meId, username)
        setCall(room)
        setCallThread(tid)
        setCallPeer(activeRef.current)
      } catch (err: any) { toastErr(err.message ?? String(err)) }
      finally { setConnectingThread(null); setConnectingPeer(null) }
    }
    window.addEventListener('ponoi-join-call', h)
    return () => window.removeEventListener('ponoi-join-call', h)
    // eslint-disable-next-line
  }, [])

  // При размонтировании не оставляем «висящий» звонок и гудки.
  // eslint-disable-next-line
  useEffect(() => () => { endRing(false); try { callRef.current?.disconnect() } catch {}; finishCallMsg() }, [])

  useEffect(() => { loadRequests() /* eslint-disable-next-line */ }, [])

  useEffect(() => {
    const ch = supabase.channel('fr:' + meId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => loadRequests())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line
  }, [])

  async function loadRequests() {
    const { data } = await supabase.from('friend_requests').select('*')
      .or('from_user.eq.' + meId + ',to_user.eq.' + meId)
    const all = (data ?? []) as FriendRequest[]
    setRequests(all.filter(r => r.status === 'pending' && r.to_user === meId))
    setOutgoing(all.filter(r => r.status === 'pending' && r.from_user === meId))
    const fr: Friend[] = all.filter(r => r.status === 'accepted').map(r =>
      r.from_user === meId ? { id: r.to_user, name: r.to_name } : { id: r.from_user, name: r.from_name })
    setFriends(fr)
  }

  // v1.73.0: при запуске приложения всегда открывается список «Друзья» —
  // авто-открытие чата с последним другом (v1.64.0) убрано по просьбе владельца.
  // Открытый чат в рамках сессии по-прежнему переживает походы на серверы (v1.64.0).

  async function doSearch(v: string) { setQ(v); setResults(await searchUsers(v, meId)) }

  // v1.122.0: перед отправкой проверяем, что заявка вообще уместна.
  // Возвращает 'ACCEPTED' (встречная входящая — приняли и вы теперь друзья),
  // текст причины отказа, либо null (можно отправлять).
  async function precheck(p: Profile): Promise<string | null> {
    const { data } = await supabase.from('friend_requests').select('*')
      .or(`and(from_user.eq.${meId},to_user.eq.${p.id}),and(from_user.eq.${p.id},to_user.eq.${meId})`)
    const rows = (data ?? []) as FriendRequest[]
    if (rows.some(r => r.status === 'accepted')) return 'Вы уже друзья с ' + (p.display_name || p.username)
    const incoming = rows.find(r => r.status === 'pending' && r.from_user === p.id)
    if (incoming) { await respondRequest(incoming.id, true); loadRequests(); return 'ACCEPTED' }
    if (rows.some(r => r.status === 'pending' && r.from_user === meId)) return 'Заявка уже отправлена — ждём ответа'
    return null
  }

  // v1.122.0: отмена своей исходящей заявки
  async function cancelOutgoing(r: FriendRequest) {
    await supabase.from('friend_requests').delete().eq('id', r.id)
    loadRequests()
  }

  async function add(p: Profile) {
    const why = await precheck(p)
    if (why === 'ACCEPTED') { setQ(''); setResults([]); toastOk((p.display_name || p.username) + ' уже отправил(а) вам заявку — теперь вы друзья!'); return }
    if (why) { toastErr(why); return }
    const { error } = await sendRequest(meId, username, p)
    if (error) toastErr(error.message); else { setQ(''); setResults([]); toastOk('Заявка отправлена — ' + (p.display_name || p.username)) }
  }

  // Добавление по юзернейму, как в новом Discord (без #цифр).
  // Старый формат «Имя#1234» тоже принимаем — цифры просто отбрасываем.
  async function addByName() {
    const name = code.trim().replace(/^@/, '').replace(/#\d+$/, '').trim()
    if (!name) return
    const p = await findByUsername(name)
    if (!p) { setCodeOk(false); setCodeMsg('Хм, не получилось. Проверь, что имя пользователя введено правильно.'); return }
    if (p.id === meId) { setCodeOk(false); setCodeMsg('Это твой собственный юзернейм :)'); return }
    const why = await precheck(p)
    if (why === 'ACCEPTED') { setCode(''); setResults([]); setCodeOk(true); setCodeMsg('У вас уже была входящая заявка от ' + (p.display_name || p.username) + ' — теперь вы друзья!'); return }
    if (why) { setCodeOk(false); setCodeMsg(why); return }
    const { error } = await sendRequest(meId, username, p)
    if (error) { setCodeOk(false); setCodeMsg(error.message) }
    else { setCode(''); setResults([]); setCodeOk(true); setCodeMsg('Успешно! Запрос дружбы отправлен пользователю ' + (p.display_name || p.username) + '.') }
  }

  // v1.51.0: удаление из друзей из меню «⋯» (сносим заявку в обе стороны)
  async function removeFriend(f: Friend) {
    if (!await confirmUi('Удалить ' + f.name + ' из друзей?', { okText: 'Удалить' })) return
    await supabase.from('friend_requests').delete()
      .or(`and(from_user.eq.${meId},to_user.eq.${f.id}),and(from_user.eq.${f.id},to_user.eq.${meId})`)
    if (active?.id === f.id) { setActive(null); setThreadId(null) }
    loadRequests()
    toastOk(f.name + ' удалён(а) из друзей')
  }

  async function openChat(f: Friend) {
    try { localStorage.setItem('ponoi_last_dm_friend', JSON.stringify({ id: f.id, name: f.name })) } catch {}
    setActive(f)
    setActiveGroup(null)
    closeMobNav()
    // Сброс случайного выделения текста при переключении диалога.
    window.getSelection()?.removeAllRanges()
    // v1.103.0: мгновенное открытие — id диалога и последние сообщения берём из кэша
    // (лента появляется сразу), а сеть освежает её в фоне.
    const cachedTid = getCachedThreadId(f.id)
    if (cachedTid) {
      setThreadId(cachedTid)
      const cached = getMsgs('dm_' + cachedTid)
      if (cached?.length) { pendingScroll.current = 'bottom'; setMessages(tagIgnored(cached as DMMessage[])) }
    }
    let t: DMThread | null = null
    try { t = await openThread(meId, f.id) } catch { t = null }
    if (!t) {
      // v1.226.0: раньше тут был молчаливый return — active уже указывал на f (шапка
      // и композер показывали этого друга), а threadId оставался ПРЕЖНИМ (от того,
      // что было открыто до этого, включая null) — сообщения либо улетали не в тот
      // диалог, либо (без кэша) не отправлялись вовсе без единой ошибки, при этом
      // выглядело так, будто «переписка пересоздалась». Явный откат + тост об ошибке.
      toastErr('Не удалось открыть диалог с ' + f.name + ' — попробуй ещё раз')
      if (!cachedTid) { setActive(null); setThreadId(null); setMessages([]) }
      return
    }
    rememberThreadId(f.id, t.id)
    setThreadId(t.id)
    // Загружаем последние 100 сообщений (раньше в длинных диалогах грузились самые старые 100).
    const { data, error } = await supabase.from('dm_messages').select('*')
      .eq('thread_id', t.id).order('created_at', { ascending: false }).limit(100)
    if (error) { toastErr('Не удалось загрузить сообщения — показаны последние сохранённые'); return }
    const list = tagIgnored(((data ?? []) as DMMessage[]).reverse())
    hasMore.current = (data ?? []).length === 100
    // v1.69.0: ЛС всегда открывается в самом низу — на последних сообщениях (как в Discord).
    pendingScroll.current = 'bottom'
    setMessages(list)
    // Разделитель «НОВОЕ»: первое чужое сообщение после последнего визита в ЛС.
    const lastRead = getDmRead(t.id)
    const firstNew = lastRead ? list.find(m => m.author !== meId && new Date(m.created_at).getTime() > lastRead) : undefined
    setNewDividerId(firstNew?.id ?? null)
    setDmRead(t.id, Date.now())
    loadRx(list.map(m => m.id))
  }

  // v1.223.0: список моих групповых бесед — начальная загрузка + realtime, когда
  // МЕНЯ добавили в новую беседу или убрали/я вышел (dm_participants со своим user_id).
  useEffect(() => {
    let ok = true
    fetchGroupThreads(meId).then(g => { if (ok) setGroups(g) })
    return () => { ok = false }
  }, [meId])
  useEffect(() => {
    const ch = supabase.channel('gdm-mine:' + meId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_participants', filter: 'user_id=eq.' + meId },
        () => fetchGroupThreads(meId).then(setGroups))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'dm_participants', filter: 'user_id=eq.' + meId },
        () => fetchGroupThreads(meId).then(setGroups))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [meId])
  // Имена участников для подписи беседы в сайдбаре (может быть не-друг — не
  // всегда есть в friends, поэтому отдельный батч-запрос профилей).
  useEffect(() => {
    const need = new Set<string>()
    for (const g of groups) for (const id of g.memberIds) {
      if (id !== meId && !friends.some(f => f.id === id) && !(id in groupNameCache)) need.add(id)
    }
    if (need.size === 0) return
    supabase.from('profiles').select('id,username,display_name').in('id', [...need]).then(({ data }) => {
      const add: Record<string, string> = {}
      for (const r of (data ?? []) as any[]) add[r.id] = r.display_name || r.username
      setGroupNameCache(c => ({ ...c, ...add }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])
  function friendNameOf(id: string): string {
    return friends.find(f => f.id === id)?.name ?? groupNameCache[id] ?? '…'
  }
  function groupLabel(g: GroupThread): string {
    if (g.name) return g.name
    return groupDisplayName(g.memberIds.filter(id => id !== meId).map(friendNameOf))
  }
  // Realtime состава/названия ОТКРЫТОЙ группы — участники видят изменения друг
  // друга сразу (добавили/убрали/переименовали), а не только после перезахода.
  useEffect(() => {
    if (!activeGroup) return
    const tid = activeGroup.id
    const ch = supabase.channel('gdm:' + tid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_participants', filter: 'thread_id=eq.' + tid },
        () => { fetchGroupMembers(tid).then(setGroupMembers); fetchGroupThreads(meId).then(setGroups) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_threads', filter: 'id=eq.' + tid },
        p => { const row = p.new as any; setActiveGroup(g => (g && g.id === tid) ? { ...g, name: row.name ?? null, ownerId: row.owner_id ?? null } : g) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup?.id])

  async function openGroupChat(g: GroupThread) {
    setActive(null)
    setActiveGroup(g)
    setShowProfile(false)
    closeMobNav()
    window.getSelection()?.removeAllRanges()
    setThreadId(g.id)
    fetchGroupMembers(g.id).then(setGroupMembers).catch(() => toastErr('Не удалось загрузить участников беседы'))
    const cached = getMsgs('dm_' + g.id)
    if (cached?.length) { pendingScroll.current = 'bottom'; setMessages(tagIgnored(cached as DMMessage[])) }
    const { data, error } = await supabase.from('dm_messages').select('*')
      .eq('thread_id', g.id).order('created_at', { ascending: false }).limit(100)
    if (error) {
      // v1.226.0: не затираем уже показанные (кэшированные) сообщения пустым списком
      // из-за сетевой/RLS ошибки — иначе беседа выглядела бы «стёртой».
      toastErr('Не удалось загрузить сообщения — показаны последние сохранённые')
      return
    }
    const list = tagIgnored(((data ?? []) as DMMessage[]).reverse())
    hasMore.current = (data ?? []).length === 100
    pendingScroll.current = 'bottom'
    setMessages(list)
    const lastRead = getDmRead(g.id)
    const firstNew = lastRead ? list.find(m => m.author !== meId && new Date(m.created_at).getTime() > lastRead) : undefined
    setNewDividerId(firstNew?.id ?? null)
    setDmRead(g.id, Date.now())
    loadRx(list.map(m => m.id))
  }

  // Ctrl+K: открыть личку с другом по событию из QuickSwitcher.
  useEffect(() => {
    const h = (e: Event) => { const f = (e as CustomEvent).detail; if (f?.id && f?.name) openChat(f) }
    window.addEventListener('ponoi-open-dm', h)
    return () => window.removeEventListener('ponoi-open-dm', h)
    // eslint-disable-next-line
  }, [])

  // Диплинк «Скопировать ссылку на сообщение» из ЛС: известен id диалога, а не
  // друга — находим собеседника через dm_threads и открываем чат как обычно.
  useEffect(() => {
    const h = async (e: Event) => {
      const d = (e as CustomEvent).detail as { threadId: string; messageId?: string } | undefined
      if (!d?.threadId) return
      const { data: t } = await supabase.from('dm_threads').select('user_a,user_b').eq('id', d.threadId).maybeSingle()
      if (!t) { toastErr('Диалог не найден'); return }
      const otherId = t.user_a === meId ? t.user_b : t.user_a
      const f = friends.find(x => x.id === otherId) ?? { id: otherId, name: 'Пользователь' }
      await openChat(f)
      const mid = d.messageId
      if (!mid) return
      let tries = 0
      const tick = () => {
        if (document.getElementById('msg-' + mid)) { jumpToMessage(mid); return }
        if (++tries < 20) window.setTimeout(tick, 250)
      }
      window.setTimeout(tick, 400)
    }
    window.addEventListener('ponoi-open-dm-thread', h)
    return () => window.removeEventListener('ponoi-open-dm-thread', h)
    // eslint-disable-next-line
  }, [friends])

  // v1.72.0: возвращение на экран ЛС (с сервера/музыки) — плавно в самый низ
  // открытого чата, к новым сообщениям. Двойной rAF — ждём, пока экран снова
  // станет видимым (display переключается с none), иначе скролл не сработает.
  useEffect(() => {
    const h = () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!bottomRef.current) return
        bottomRef.current.scrollIntoView({ behavior: 'smooth' })
        setUnseen(0); setAtBottom(true)
      }))
    }
    window.addEventListener('ponoi-dm-shown', h)
    return () => window.removeEventListener('ponoi-dm-shown', h)
  }, [])

  useEffect(() => {
    if (!threadId) return
    const ch = supabase.channel('dm:' + threadId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: 'thread_id=eq.' + threadId },
        p => {
          const msg = p.new as DMMessage
          // v1.187.0: написал в 1-в-1 — «Закрыть ЛС» снимается, как в Discord. Не для
          // групп — иначе сообщение в беседе ошибочно «переоткрывало» бы чей-то не
          // связанный с ней закрытый 1-в-1 диалог с тем же автором.
          if (!activeGroup && isDmClosed(msg.author)) reopenDm(msg.author)
          setMessages(m => mergeIncoming(m, { ...msg, _ignoredAuthor: isDmIgnored(msg.author) } as any))
          setDmRead(threadId, Date.now())
          if (msg.author !== meId && !parseSys(msg.content) && !isDmMuted(msg.author)) {
            msgSound()
            // v1.223.0: в группе activeAvatar (аватар «активного друга») не подходит —
            // сообщение может быть от любого из участников, берём его аватар из общего кэша.
            notifyMessage(msg.author_name, msg.content ?? '', activeGroup ? avatarOf(msg.author) : activeAvatar, 'dm:' + threadId)
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_messages', filter: 'thread_id=eq.' + threadId },
        p => { const msg = p.new as DMMessage; setMessages(m => m.map(x => x.id === msg.id ? { ...msg, _localId: (x as any)._localId, _ignoredAuthor: isDmIgnored(msg.author) } as any : x)) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [threadId])

  // v1.199.0: вернулся в приложение — сразу убрать уведомление по этому чату,
  // не дожидаясь автозакрытия через 8 сек (см. src/lib/notify.ts).
  useEffect(() => {
    if (!threadId) return
    const onFocus = () => closeNotif('dm:' + threadId)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [threadId])

  useEffect(() => {
    const el = msgsBoxRef.current
    if (el && prevHeight.current !== null) {
      // Подгрузили старые сообщения — сохраняем видимую позицию без прыжка.
      el.scrollTop = prevTop.current + (el.scrollHeight - prevHeight.current)
      prevHeight.current = null
    } else if (el && pendingScroll.current !== null) {
      // Восстановление сохранённой позиции прокрутки при входе в канал.
      if (pendingScroll.current === 'bottom') { el.scrollTop = el.scrollHeight; stickToBottom() }
      else el.scrollTop = pendingScroll.current
      pendingScroll.current = null
      setUnseen(0); setAtBottom(true)
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
    if (el && threadId) scrollMem.current['dm_' + threadId] = el.scrollTop
    if (el && el.scrollTop < 60 && Date.now() > stickUntil.current) loadOlder()
    const nb = nearBottom()
    setAtBottom(nb)
    if (nb) setUnseen(0)
  }

  // Динамическая подгрузка старых сообщений небольшими порциями при прокрутке вверх.
  async function loadOlder() {
    const el = msgsBoxRef.current
    if (!threadId || !el || loadingOlder.current || !hasMore.current || msgsRef.current.length === 0) return
    loadingOlder.current = true
    try {
      const oldest = msgsRef.current[0].created_at
      const { data } = await supabase.from('dm_messages').select('*')
        .eq('thread_id', threadId).lt('created_at', oldest)
        .order('created_at', { ascending: false }).limit(50)
      const older = tagIgnored(((data ?? []) as DMMessage[]).reverse())
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

  useEffect(() => { msgsRef.current = messages }, [messages])

  // Предупреждение браузера при попытке закрыть вкладку с активным звонком.
  useEffect(() => {
    if (!call) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [call])

  // Escape закрывает панель закреплённых.
  useEffect(() => {
    if (!showPins) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPins(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [showPins])

  // v1.103.0: кэшируем последние сообщения открытого диалога — повторное открытие мгновенно.
  useEffect(() => { if (threadId && messages.length) putMsgs('dm_' + threadId, messages) }, [messages, threadId])

  useEffect(() => {
    if (!threadId) return
    const ch = supabase.channel('drx:' + threadId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_reactions' },
        () => { window.clearTimeout(dmRxDeb); dmRxDeb = window.setTimeout(() => loadRx(msgsRef.current.map(m => m.id)), 250) })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [threadId])

  // v1.66.0: мгновенная отправка (как в Discord) — сообщение появляется в ленте
  // сразу, сеть догоняет в фоне; при ошибке черновик убирается с тостом.
  // v1.179.0: замена временного сообщения настоящим (пришедшим по realtime раньше,
  // чем ответ на сам insert) теряла _localId — React видел смену ключа (tmp-id -> id
  // с сервера), размонтировал и заново монтировал узел, анимация появления
  // проигрывалась второй раз подряд («дёргается»). Переносим _localId со старого
  // временного сообщения на новое, чтобы ключ не менялся.
  function mergeIncoming(list: DMMessage[], msg: DMMessage): DMMessage[] {
    if (list.some(x => x.id === msg.id)) return list.map(x => x.id === msg.id ? { ...msg, _localId: (x as any)._localId } as any : x)
    if (msg.author === meId) {
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
    // v1.226.0: раньше молча ничего не делал, если диалог не успел открыться
    // (или открытие сорвалось) — сообщение просто пропадало без единого признака
    // ошибки. Теперь явно говорим, что писать пока некуда.
    if (!threadId) { toastErr('Диалог ещё не открыт — подожди немного или открой его заново'); return }
    const tmpId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2)
    const row = {
      thread_id: threadId, author: meId, author_name: username, content: t,
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
    const peer = active
    const groupRecipients = activeGroup ? activeGroup.memberIds.filter(id => id !== meId) : null

    function finalize(finalRow: typeof row) {
      supabase.from('dm_messages').insert(finalRow).select().single().then(({ data, error }) => {
        if (error || !data) {
          setMessages(m => m.filter(x => x.id !== tmpId))
          toastErr(error?.message ?? 'Не удалось отправить сообщение')
          return
        }
        const real = data as DMMessage
        setMessages(m => m.some(x => x.id === real.id) ? m.filter(x => x.id !== tmpId) : m.map(x => x.id === tmpId ? { ...real, _localId: tmpId } as any : x))
        if (peer) sendPush([peer.id], username, t || 'Вложение', '/')
        else if (groupRecipients?.length) sendPush(groupRecipients, username, t || 'Вложение', '/')
      })
    }

    if (!uploading) { finalize(row); return }
    try {
      const spoilerFlags = attach!.url.split('\n').map(u => u.includes('#spoiler'))
      const realUrls: string[] = []
      for (let i = 0; i < files!.length; i++) {
        let url = await uploadWithProgress('attachments', meId, files![i], p => {
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
    const rows = await loadReactions('dm_reactions', ids)
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
    optimisticRx(id, emoji, meId)
    await toggleReaction('dm_reactions', id, meId, emoji)
    loadRx(msgsRef.current.map(m => m.id))
  }
  async function pin(id: string, pinned: boolean) {
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, pinned } as any) : m)))
    await setPin('dm_messages', id, pinned)
  }
  async function removeMsg(id: string) {
    if (!await confirmUi('Удалить сообщение?', { okText: 'Удалить' })) return
    setMessages(ms => ms.filter(m => m.id !== id))
    deleteMessage('dm_messages', id)
  }
  async function editMsg(id: string, content: string) {
    setMessages(ms => ms.map(m => (m.id === id ? ({ ...m, content, edited: true } as any) : m)))
    await editMessage('dm_messages', id, content)
  }
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
      const res = await updateAttachment('dm_messages', msg as any, index, patch)
      if (res) setMessages(ms => ms.map(m => (m.id === messageId ? ({ ...m, attach_url: res.attach_url, attach_meta: res.attach_meta } as any) : m)))
    } catch (e: any) { toastErr(e.message ?? String(e)) }
  }

  const callRoomShown = !!call && !!active && callThread === threadId
  useEffect(() => { crShownRef.current = callRoomShown }, [callRoomShown])

  // v1.187.0: список ЛС в сайдбаре — «Закрыть ЛС» прячет, «Закрепить» поднимает
  // наверх. Пересчитывается на каждый рендер; DmCtxMenu триггерит его через
  // setPrefsTick после любого изменения в user_prefs (закреп/мьют/etc — не React-стейт).
  const sidebarFriends = friends.filter(f => !isDmClosed(f.id))
  const pinnedFriends = sidebarFriends.filter(f => isDmPinned(f.id))
  const restFriends = sidebarFriends.filter(f => !isDmPinned(f.id))

  return (
    <>
      {call && !callRoomShown && <Sinks room={call} meName={username} />}
      <aside className="dm-side">
        <div className="dm-top">
          {IS_MOBILE && <div className="dm-top-title">Сообщения</div>}
          <div className="dm-top-row">
            <button className="dm-findbtn" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}>
              {IS_MOBILE && <Icon name="search" size={15} />}Найти или начать беседу
            </button>
            {IS_MOBILE && <button className="dm-sec-plus dm-top-plus" title="Новая беседа" onClick={() => setNewConvOpen(true)}><Icon name="plus" size={18} /></button>}
          </div>
        </div>
        <div className={'dm-navitem' + (!active && !activeGroup ? ' on' : '')} onClick={() => { setActive(null); setActiveGroup(null); closeMobNav() }}>
          <span className="dm-nav-ic"><Icon name="users" size={20} /></span> Друзья
          {requests.length > 0 && <span className="dm-req-badge" title="Входящие заявки в друзья">{requests.length}</span>}
        </div>

        <div className="dm-sec-t2"><span>Личные сообщения</span>
          <button className="dm-sec-plus" title="Новая беседа" onClick={() => setNewConvOpen(true)}><Icon name="plus" size={14} /></button>
        </div>
        <div className="ch-list">
          {[...pinnedFriends, ...restFriends].map(f => (
            <div key={f.id} className={'dm-item' + (active?.id === f.id ? ' on' : '')} onClick={() => openChat(f)}
              onContextMenu={e => { e.preventDefault(); setDmCtx({ friend: f, x: e.clientX, y: e.clientY }) }}>
              <AvatarWithStatus name={f.name} userId={f.id} size={IS_MOBILE ? 48 : 32} status={statusOf(f.id)} mobile={deviceOf(f.id) === 'mobile'} />
              <span className="me-nm">{friendNickOf(f.id) ?? f.name}
                {isDmPinned(f.id) && <Icon name="pin" size={12} />}
                {(() => { const g = gameOf(f.id); return g ? <GameLine game={g} /> : null })()}
              </span>
            </div>
          ))}
          {friends.length === 0 && <div className="mut" style={{ padding: '6px 12px', fontSize: 13 }}>Пока нет друзей. Открой «Друзья» и добавь кого-нибудь.</div>}
        </div>
        {groups.length > 0 && <>
          <div className="dm-sec-t2"><span>Групповые беседы</span></div>
          <div className="ch-list">
            {groups.map(g => {
              const others = g.memberIds.filter(id => id !== meId)
              return (
                <div key={g.id} className={'dm-item' + (activeGroup?.id === g.id ? ' on' : '')} onClick={() => openGroupChat(g)}>
                  <span className="gdm-avstack">
                    {others.slice(0, 2).map(id => <Avatar key={id} name={friendNameOf(id)} userId={id} size={others.length > 1 ? 22 : 32} />)}
                  </span>
                  <span className="me-nm">{groupLabel(g)}</span>
                </div>
              )
            })}
          </div>
        </>}
        {call && <div className="vp vp-dm">
          {cstate.screen && <div className="vp-screen"><span className="vp-screen-ic"><Icon name="screen-share" size={14} /></span><span className="vp-screen-t">Экран 1</span><button className="vp-btn danger" title="Остановить демонстрацию" onClick={() => tglCall('screen')}><Icon name="close" size={14} /></button></div>}
          <div className="vp-row">
            <div className="vp-info">
              <div className="vp-status"><span className="vp-dot" />{cstate.connected ? 'Голосовая связь подключена' : 'Соединение…'}</div>
              <div className="vp-ch">{(ringingTo?.name ?? callPeer?.name) || 'Личный звонок'}</div>
            </div>
            <button className="vp-btn danger" title="Отключиться" onClick={() => hangUp(true)}><Icon name="phone-off" size={17} /></button>
          </div>
          <div className="vp-acts">
            <button className={'vp-act' + (cstate.cam ? ' on' : '')} title={cstate.cam ? 'Выключить камеру' : 'Включить камеру'} onClick={() => tglCall('cam')}><Icon name={cstate.cam ? 'video' : 'video-off'} size={17} /></button>
            <button className={'vp-act' + (cstate.screen ? ' live' : '')} title={cstate.screen ? 'Остановить демонстрацию' : 'Демонстрация экрана'} onClick={() => tglCall('screen')}><Icon name="screen-share" size={17} /></button>
            <button className={'vp-act' + (cstate.mic ? '' : ' off')} title={cstate.mic ? 'Выключить микрофон' : 'Включить микрофон'} onClick={() => tglCall('mic')}><Icon name={cstate.mic ? 'mic' : 'mic-off'} size={17} /></button>
            <button className={'vp-act' + (cstate.deaf ? ' off' : '')} title={cstate.deaf ? 'Включить звук' : 'Заглушить всех'} onClick={() => tglCall('deaf')}><Icon name={cstate.deaf ? 'headphones-off' : 'headphones'} size={17} /></button>
          </div>
        </div>}
        <MeBar username={username} avatarUrl={avatarUrl} onAvatar={onAvatar} />
      </aside>

      <main className="chat">
        {(active || activeGroup) ? <>
          <header className="chat-head ph2"><button className="mob-burger" onClick={openMobNav} title={IS_MOBILE ? 'Назад' : 'Меню'}>{IS_MOBILE ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>}</button>
            {activeGroup ? <><Icon name="users" size={16} /> {groupLabel(activeGroup)}</> : <>{!IS_MOBILE && '@ '}{active!.name}</>}
            <div className="ph2-btns">
              <button className={'pin-btn' + (showPins ? ' on' : '')} title="Закреплённые" onClick={() => setShowPins(s => !s)}><Icon name="pin" size={18} />{messages.filter(m => (m as any).pinned).length > 0 && <span className="pin-count">{messages.filter(m => (m as any).pinned).length}</span>}</button>
              {/* v1.223.0: групповые звонки — не в этой версии, кнопка звонка есть только 1-в-1 */}
              {!activeGroup && <button className="call-start" title="Позвонить" onClick={startCall}><Icon name="phone" size={18} /></button>}
              <button className={'pin-btn' + (showProfile ? ' on' : '')} title={showProfile ? 'Скрыть панель' : (activeGroup ? 'Участники' : 'Показать профиль')}
                onClick={() => setShowProfile(v => !v)}><Icon name={activeGroup ? 'users' : 'user'} size={18} /></button>
            </div>
          </header>
          {showPins && <div className="pins-panel">
            <div className="pins-h"><Icon name="pin" size={15} /> Закреплённые сообщения</div>
            {messages.filter(m => (m as any).pinned).length === 0 && <div className="mut" style={{ padding: 10, fontSize: 13 }}>Нет закреплённых сообщений</div>}
            {messages.filter(m => (m as any).pinned).map(m => (
              <div key={m.id} className="pin-row clickable" title="Перейти к сообщению" onClick={() => { setShowPins(false); jumpToMessage(m.id) }}><b>{m.author_name}:</b> <span>{m.content}</span>
                <button className="pin-un" title="Открепить" onClick={e => { e.stopPropagation(); pin(m.id, false) }}><Icon name="close" size={14} /></button></div>
            ))}
          </div>}
          {!activeGroup && connectingThread === threadId && !(call && callThread === threadId) &&
            <div className="dm-call-connecting"><Icon name="phone" size={15} /> Соединение{connectingPeer ? ' с ' + connectingPeer.name : ''}…</div>}
          {!activeGroup && call && callThread === threadId && <CallRoom room={call} meId={meId} meName={username} peer={ringingTo ? { name: ringingTo.name, avatarUrl: null } : null} onLeave={() => hangUp(true)}
            onProfile={(userId, name, avatarUrl, x, y) => setMini({ userId, name, avatarUrl: avatarUrl ?? null, status: statusOf(userId), x, y })} />}
          <div className="msgs" ref={msgsBoxRef} onScroll={onMsgsScroll}
            onWheel={() => { stickUntil.current = 0 }} onTouchMove={() => { stickUntil.current = 0 }}>
            <MessageList messages={(messages as any).filter((m: any) => !isBlockedWith(m.author))} reactions={reactions} currentUser={meId} currentUserName={username} newDividerId={newDividerId}
              linkCtx={threadId ? { kind: 'dm', dmId: threadId } : undefined}
              nameOf={id => id === meId ? username : (activeGroup ? (groupMembers.find(p => p.id === id)?.display_name || groupMembers.find(p => p.id === id)?.username) : active!.name)}
              canPin={() => true} onReact={react} onPin={pin} onDelete={removeMsg} onEditAttachment={editAttachment}
              onReply={m => { setReplyTarget({ id: m.id, author: m.author_name, preview: (m.content || 'вложение').slice(0, 120), avatarUrl: m.author === meId ? avatarUrl : (activeGroup ? (groupMembers.find(p => p.id === m.author)?.avatar_url ?? null) : activeAvatar) }); setEditingMsg(null) }}
              onStartEdit={m => { setEditingMsg({ id: m.id, content: m.content ?? '' }); setReplyTarget(null) }} editingId={editingMsg?.id ?? null}
              onMarkUnread={m => { setNewDividerId(m.id); if (threadId) setDmRead(threadId, new Date(m.created_at).getTime() - 1) }}
              onProfile={(m, x, y) => setMini({ userId: m.author, name: m.author_name, avatarUrl: m.author === meId ? avatarUrl : (activeGroup ? (groupMembers.find(p => p.id === m.author)?.avatar_url ?? null) : null), status: statusOf(m.author), x, y })} />
            {!atBottom && <button className="jump-down" onClick={jumpDown}>
            {unseen > 0 ? `Новых сообщений: ${unseen}` : 'К последним'} <Icon name="chevron-down" size={14} />
          </button>}
          <div ref={bottomRef} />
          </div>
          <TypingIndicator typers={typers} />
          <Composer placeholder={activeGroup ? 'Написать в ' + groupLabel(activeGroup) : 'Написать @' + active!.name} onSend={sendMsg} draftKey={threadId ? 'dm_' + threadId : undefined}
            mentionables={activeGroup ? [...groupMembers.map(m => m.display_name || m.username), username] : [active!.name, username]}
            replyingTo={replyTarget ? { author: replyTarget.author, preview: replyTarget.preview, avatarUrl: replyTarget.avatarUrl } : null}
            onCancelReply={() => setReplyTarget(null)} onType={notifyTyping}
            editingTarget={editingMsg} onSaveEdit={saveEditedMsg} onCancelEdit={() => setEditingMsg(null)} />
        </> : <>
          <header className="chat-head pfr-head">
            <button className="mob-burger" onClick={openMobNav} title="Меню"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button><span className="pfr-title"><Icon name="users" size={20} /> Друзья</span>
            <span className="pfr-vsep" />
            <div className="pfr-tabs">
              <button className={'pfr-tab' + (tab === 'online' ? ' on' : '')} onClick={() => setTab('online')}>В сети</button>
              <button className={'pfr-tab' + (tab === 'all' ? ' on' : '')} onClick={() => setTab('all')}>Все</button>
              <button className={'pfr-tab' + (tab === 'pending' ? ' on' : '')} onClick={() => setTab('pending')}>Ожидание{requests.length > 0 ? ' — ' + requests.length : ''}</button>
            </div>
            <button className={'pfr-addfriend' + (tab === 'add' ? ' on' : '')} onClick={() => setTab('add')}>Добавить в друзья</button>
          </header>
          <div className="pfr-main">
          <div className="pfr-body">
            {tab === 'add' ? <div className="pfr-add2">
              <div className="pfr-add2-head">
                <div className="pfr-add2-tx">
                  <div className="pfr-add2-h">Добавить в друзья</div>
                  <div className="pfr-add2-sub">Вы можете добавить друзей по имени пользователя в Ponoi.</div>
                </div>
                <svg className="pfr-add2-mascot" viewBox="0 0 120 100" fill="none" aria-hidden="true">
                  <ellipse cx="62" cy="93" rx="34" ry="5" fill="rgba(0,0,0,.35)"/>
                  <path d="M36 42 q-16 -2 -18 -16" stroke="#5865f2" strokeWidth="9" strokeLinecap="round"/>
                  <circle cx="16" cy="24" r="8" fill="#eef0ff"/>
                  <rect x="34" y="26" width="56" height="50" rx="17" fill="#5865f2"/>
                  <rect x="42" y="70" width="40" height="21" rx="8" fill="#eef0ff"/>
                  <rect x="56" y="74" width="12" height="6" rx="3" fill="#5865f2"/>
                  <circle cx="53" cy="48" r="5" fill="#fff"/>
                  <circle cx="72" cy="48" r="5" fill="#fff"/>
                  <path d="M55 61 q8 7 16 0" stroke="#fff" strokeWidth="3" strokeLinecap="round"/>
                  <path d="M64 26 q1 -9 9 -12" stroke="#23a55a" strokeWidth="5" strokeLinecap="round"/>
                  <ellipse cx="78" cy="12" rx="9" ry="5" fill="#23a55a" transform="rotate(-15 78 12)"/>
                </svg>
              </div>
              <div className={'pfr-add2-inwrap' + (codeMsg ? (codeOk ? ' ok' : ' err') : '')}>
                <input placeholder="Введите имя пользователя" value={code}
                  onChange={e => { setCode(e.target.value); setCodeMsg(''); doSearch(e.target.value) }}
                  onKeyDown={e => { if (e.key === 'Enter') addByName() }} />
                <button className="pfr-add2-send" disabled={!code.trim()} onClick={addByName}>Отправить запрос дружбы</button>
              </div>
              {codeMsg && <div className={'pfr-add2-msg' + (codeOk ? ' ok' : ' err')}>{codeMsg}</div>}
              {!codeMsg && <div className="pfr-add2-hint">Твой юзернейм — <b title="Скопировать" onClick={() => { navigator.clipboard?.writeText(handle || username); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>{handle || username}</b>{copied ? ' — скопировано \u2713' : '. Нажми на него, чтобы скопировать и поделиться.'}</div>}
              {q.trim().length > 1 && results.filter(p => p.id !== meId).length > 0 && <div className="pfr-add2-results">
                <div className="pfr-sec">Похожие пользователи</div>
                {results.filter(p => p.id !== meId).map(p => (
                  <div key={p.id} className="pfr-row" onClick={() => add(p)}>
                    <Avatar name={p.display_name || p.username} url={p.avatar_url} userId={p.id} size={32} />
                    <span className="pfr-name">{p.display_name || p.username}<span className="pfr-uname">{p.username}</span></span>
                    <span className="pfr-add-btn"><Icon name="plus" size={14} /> Добавить</span>
                  </div>
                ))}
              </div>}
              <div className="pfr-add2-div" />
              <div className="pfr-add2-h2">Где ещё можно завести друзей</div>
              <div className="pfr-add2-sub">Нет знакомых пользователей? Тогда просмотри наш список открытых серверов — там найдётся всё, от игр до музыки и многого другого.</div>
              <button className="pfr-add2-explore" onClick={() => window.dispatchEvent(new Event('ponoi-open-discover'))}>
                <span className="pfr-add2-exic"><Icon name="compass" size={20} /></span>
                <span className="pfr-add2-extx">Исследуйте доступные серверы</span>
                <Icon name="chevron-right" size={18} />
              </button>
            </div>
            : tab === 'pending' ? <>
              <div className="pfr-sec">Входящие — {requests.length}</div>
              {requests.length === 0 && <div className="pfr-empty">Нет входящих заявок</div>}
              {requests.map(r => (
                <div key={r.id} className="pfr-row">
                  <Avatar name={r.from_name} userId={r.from_user} size={32} />
                  <span className="pfr-name">{r.from_name}</span>
                  <button className="pfr-ok" title="Принять" onClick={() => respondRequest(r.id, true).then(loadRequests)}><Icon name="check" size={16} /></button>
                  <button className="pfr-no" title="Отклонить" onClick={() => respondRequest(r.id, false).then(loadRequests)}><Icon name="close" size={16} /></button>
                </div>
              ))}
              <div className="pfr-sec pfr-sec-out">Исходящие — {outgoing.length}</div>
              {outgoing.length === 0 && <div className="pfr-empty">Нет исходящих заявок</div>}
              {outgoing.map(r => (
                <div key={r.id} className="pfr-row">
                  <Avatar name={r.to_name} userId={r.to_user} size={32} />
                  <span className="pfr-name">{r.to_name}<small className="pfr-sub">Ждём ответа</small></span>
                  <button className="pfr-no" title="Отменить заявку" onClick={() => cancelOutgoing(r)}><Icon name="close" size={16} /></button>
                </div>
              ))}
            </>
            : (() => {
                const base = tab === 'online' ? friends.filter(f => statusOf(f.id) !== 'offline') : friends
                const list = ffilter ? base.filter(f => f.name.toLowerCase().includes(ffilter.toLowerCase())) : base
                return <>
                  <div className="pfr-search pfr-search2"><Icon name="search" size={16} /><input placeholder="Поиск" value={ffilter} onChange={e => setFfilter(e.target.value)} /></div>
                  <div className="pfr-sec">{tab === 'online' ? 'В сети' : 'Все друзья'} — {list.length}</div>
                  {list.length === 0 && <div className="pfr-empty">{tab === 'online' ? 'Сейчас никого нет в сети' : 'Пока нет друзей. Добавь кого-нибудь во вкладке «Добавить в друзья».'}</div>}
                  {list.map(f => (
                    <div key={f.id} className="pfr-row pfr-row2" onClick={() => openChat(f)}>
                      <AvatarWithStatus name={f.name} userId={f.id} size={IS_MOBILE ? 48 : 32} status={statusOf(f.id)} mobile={deviceOf(f.id) === 'mobile'} />
                      <span className="pfr-nm2">
                        <span className="pfr-name">{f.name}</span>
                        <span className="pfr-substatus">{(() => { const g = gameOf(f.id); return g ? <GameInline game={g} /> : STATUS_LABEL[statusOf(f.id)] })()}</span>
                      </span>
                      <span className="pfr-acts">
                        <button className="pfr-cbtn" title="Написать" onClick={e => { e.stopPropagation(); openChat(f) }}><Icon name="message" size={18} /></button>
                        <button className="pfr-cbtn" title="Ещё" onClick={e => { e.stopPropagation(); setRowMenu(m => m === f.id ? null : f.id) }}><Icon name="dots" size={18} /></button>
                        {rowMenu === f.id && <div className="pfr-rowmenu" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setRowMenu(null); openChat(f) }}>Написать</button>
                          <button className="danger" onClick={() => { setRowMenu(null); removeFriend(f) }}>Удалить из друзей</button>
                        </div>}
                      </span>
                    </div>
                  ))}
                </>
              })()}
          </div>
          <aside className="pfr-right">
            <div className="pfr-right-h">Активные контакты</div>
            {(() => {
              // v1.90.0: 1-в-1 как «Сейчас активны» в Discord — карточки только у тех,
              // кто прямо сейчас в игре: шапка (аватар, ник, «Игра — 6 ч.», иконка игры)
              // и вложенный блок игры (обложка, название, детали/«N человек», аватарки).
              const act = friends.map(f => ({ f, g: gameOf(f.id) })).filter(x => !!x.g)
              if (act.length === 0) return <div className="an-empty"><b>Пока тихо…</b>Когда друг начнёт играть — это появится здесь!</div>
              const dur = (since: number) => { const m = Math.floor((Date.now() - since) / 60000); return m >= 60 ? Math.floor(m / 60) + ' ч.' : Math.max(1, m) + ' мин.' }
              const ruPpl = (n: number) => { const d = n % 100, r = n % 10; return n + ' ' + (d >= 11 && d <= 14 ? 'человек' : r === 1 ? 'человек' : r >= 2 && r <= 4 ? 'человека' : 'человек') }
              return act.map(({ f, g }) => {
                const same = act.filter(x => x.g!.name === g!.name)
                const cover = g!.cover ?? same.find(x => x.g!.cover)?.g!.cover ?? null
                return (
                  <div key={f.id} className="an-card" onClick={() => openChat(f)}>
                    <div className="an-head">
                      <AvatarWithStatus name={f.name} userId={f.id} size={40} status={statusOf(f.id)} mobile={deviceOf(f.id) === 'mobile'} />
                      <div className="an-tx">
                        <div className="an-nm">{f.name}</div>
                        <div className="an-sub">{g!.name} — {dur(g!.since)}</div>
                      </div>
                      {cover && <img className="an-gico" src={cover} alt="" />}
                    </div>
                    <div className="an-game">
                      {cover ? <img className="an-gcover" src={cover} alt="" /> : <span className="an-gcover an-gph"><Icon name="gamepad" size={20} /></span>}
                      <div className="an-gtx">
                        {(() => {
                          // Подробности игры («в лобби», «Напарники — Mirage · 5:3», «В матче — Ahri»)
                          // показываем ВМЕСТО названия игры — как rich-подробности в Discord;
                          // название игры и так есть в шапке карточки («Dota 2 — 6 ч.»).
                          const md = g!.mode
                          if (md && md.includes(' — ')) {
                            const i = md.indexOf(' — ')
                            return <><div className="an-gnm">{md.slice(0, i)}</div><div className="an-gsub">{md.slice(i + 3)}</div></>
                          }
                          return <><div className="an-gnm">{g!.name}</div><div className="an-gsub">{md ?? ruPpl(same.length)}</div></>
                        })()}
                      </div>
                      <span className="an-gavs">{same.slice(0, 3).map(x => <Avatar key={x.f.id} name={x.f.name} userId={x.f.id} size={24} />)}</span>
                    </div>
                  </div>
                )
              })
            })()}
          </aside>
          </div>
        </>}
      </main>
      {active && showProfile && <DmProfilePanel userId={active.id} name={active.name} avatarUrl={activeAvatar} status={statusOf(active.id)}
        onExpand={tab => setFullProfileTab(tab ?? 'board')} />}
      {active && fullProfileTab && <ProfileCard userId={active.id} name={active.name} avatarUrl={activeAvatar} status={statusOf(active.id)}
        initialTab={fullProfileTab} onClose={() => setFullProfileTab(null)} />}
      {activeGroup && showProfile && <GroupMembersPanel group={activeGroup} members={groupMembers} meId={meId} allFriends={friends}
        onLeft={() => { setActiveGroup(null); setThreadId(null); setMessages([]); fetchGroupThreads(meId).then(setGroups) }} />}
      {newConvOpen && <NewConversationModal friends={friends} onClose={() => setNewConvOpen(false)}
        onOpenFriend={f => openChat(f)}
        onGroupCreated={(tid, memberIds) => {
          fetchGroupThreads(meId).then(setGroups)
          openGroupChat({ id: tid, name: null, ownerId: meId, createdAt: new Date().toISOString(), memberIds: [...memberIds, meId] })
        }} />}
      {mini && <MiniProfile data={mini} onClose={() => setMini(null)} />}
      {dmCtx && <DmCtxMenu friend={dmCtx.friend} x={dmCtx.x} y={dmCtx.y}
        threadId={dmCtx.friend.id === active?.id ? threadId : null}
        servers={servers ?? []} meId={meId} username={username}
        onClose={() => setDmCtx(null)}
        onChanged={() => setPrefsTick(v => v + 1)}
        onProfile={() => setMini({ userId: dmCtx.friend.id, name: dmCtx.friend.name, avatarUrl: null, status: statusOf(dmCtx.friend.id), x: dmCtx.x, y: dmCtx.y })}
        onStartCall={() => { pendingCallRef.current = true; openChat(dmCtx.friend) }}
        onCloseDm={() => { closeDm(dmCtx.friend.id); if (active?.id === dmCtx.friend.id) { setActive(null); setThreadId(null) }; setPrefsTick(v => v + 1) }}
        onRemoveFriend={() => removeFriend(dmCtx.friend)}
        onBlocked={() => {
          loadRequests()   // blockUser() уже снял friend_requests в обе стороны — перечитываем список
          if (active?.id === dmCtx.friend.id) { setActive(null); setThreadId(null) }
          toastOk(dmCtx.friend.name + ' заблокирован(а)')
        }} />}
    </>
  )
}
