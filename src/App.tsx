

import { Portal } from './components/Portal'
import { touchDevice } from './lib/devices'
import { supabase } from './lib/supabase'
import { updateGameState } from './lib/gameMode'
import { getSettings } from './lib/settings'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { AuthScreen } from './auth/AuthScreen'
import { Toasts, toastOk, toastErr } from './lib/toast'
import { openSafely } from './lib/safeUrl'
import { loadFavs, toggleFav } from './lib/emoji'
import { ConfirmHost } from './lib/confirm'
import { Icon } from './components/icons'
// v1.435.0: история версий больше НЕ в стартовой сборке.
//
// Файл changelog.ts — четыреста килобайт русского текста, и он растёт с каждой
// версией на пару килобайт. Всё это грузилось при каждом входе всем и каждому
// ради окна, которое открывается тройным щелчком по номеру версии. Именно из-за
// него стартовый вес и подполз к потолку: 879 при 880.
//
// Теперь текст подтягивается в тот момент, когда окно открывают.
import type { ChangelogEntry } from './lib/changelog'
import { openMsgLink } from './lib/deepLink'
import { Capacitor } from '@capacitor/core'
import { checkApkUpdate, getDismissedApkVersion, dismissApkVersion, installApkInApp,
  readyApkVersion, apkNetInfo, downloadApk, installReadyApk, type ApkUpdate } from './lib/apkUpdate'
import { otaDecide, otaBanner, otaStale } from './lib/otaPlan'
import { IS_MOBILE } from './lib/mobile'
import { watchKeyboard } from './lib/keyboardInset'
import { useClampToViewport } from './lib/clampPos'
import { useNetDegraded, useNetDegradedForMs } from './lib/netStatus'
import { lazyNamed } from './lib/lazyScreen'
// Аварийный чат нужен в редкой ситуации «основной сервер лёг» — грузим тогда же.
// v1.415.0: основной экран грузится после входа, а не вместе с ним.
//
// Первое, что человек видит, — окно входа, а в стартовую сборку до сих пор
// ехало всё приложение целиком: список серверов, каналы, лента сообщений,
// поле ввода, профили. До входа это не нужно ни одной строчкой, а ждать их
// загрузки приходилось всем и каждый раз.
const EmergencyChat = lazyNamed(() => import('./components/EmergencyChat'), 'EmergencyChat')
const Home = lazyNamed(() => import('./components/Home'), 'Home')
import { startEnabledPlugins, invokePlugin, emitToPlugin, emitPluginEvent } from './lib/plugins/bridge'
import { PluginApps } from './components/PluginApps'
import { PluginDialogHost } from './components/PluginDialog'
import { pluginsDisabled, setPluginsDisabled, getHotkeys } from './lib/plugins/registry'
import { comboFromEvent, isComboComplete } from './lib/keybind'

// v1.275.0: через сколько непрерывной деградации предлагать аварийный чат —
// достаточно долго, чтобы не дёргать на секундный сбой, но не тянуть, если
// основной сервер правда лежит.
const EMERGENCY_SUGGEST_MS = 45_000

// v1.59.0: версия приложения, подставляется Vite из package.json (см. vite.config.ts)
declare const __APP_VERSION__: string

// Десктоп без системной рамки (v1.28.0): тонкий тёмный тайтлбар рисуем сами,
// а нативные кнопки «свернуть/развернуть/закрыть» отдаёт Windows-overlay
// (см. electron/main.cjs, titleBarOverlay). Вся полоска — drag-регион.
const isDesktop = typeof window !== 'undefined' && !!(window as any).neylivoDesktop?.isDesktop

/** Высота полосы заголовка — в переменную, чтобы наложения её не накрывали. */
function TitlebarHeightVar() {
  useEffect(() => {
    document.documentElement.style.setProperty('--titlebar-h', '32px')
    return () => { document.documentElement.style.removeProperty('--titlebar-h') }
  }, [])
  return null
}
// v1.213.0: настоящий APK (Capacitor-обёртка), не браузер/PWA — у той свой
// путь обновления (см. apkUpdate.ts).
const isApkNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

// v1.213.0: баннер «Доступно обновление» для APK — у десктопа авто-обновление
// уже качает и ставит само (UpdateBanner ниже), у APK самое большее, что можно —
// сверить версию и дать прямую ссылку на .apk с последнего GitHub Release;
// установку (и её подтверждение) всё равно делает сама Android.
//
// v1.443.0: обновление стало фоновым. Раньше проверка была ровно одна — при
// запуске; на телефоне приложение неделями не запускается заново, его
// сворачивают и разворачивают, поэтому о новой версии человек узнавал только
// после того, как система выгрузит приложение из памяти. И даже узнав, он жал
// «Обновить» и ждал скачивания десятков мегабайт.
//
// Теперь: проверка повторяется (при возврате в приложение и раз в несколько
// часов), файл качается заранее и сам — но только по сети без тарификации, —
// а кнопка превращается в «Установить» и срабатывает мгновенно. Расписание
// решает otaDecide (src/lib/otaPlan.ts), вид карточки — otaBanner: одна
// функция на оба вопроса, чтобы «Установить» не могло появиться раньше файла.
function ApkUpdateBanner() {
  const [upd, setUpd] = useState<ApkUpdate | null>(null)
  const [ready, setReady] = useState<string | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(() => getDismissedApkVersion())
  // Всё, что меняется вне отрисовки, держим в ссылке: планировщик читает
  // состояние из таймера и из обработчика возврата, а не из замыкания.
  const st = useRef({ lastCheck: 0, busy: false, found: null as ApkUpdate | null, ready: null as string | null })

  useEffect(() => {
    let alive = true
    async function tick(resumed: boolean) {
      if (!alive) return
      const net = await apkNetInfo()
      if (!alive) return
      const s = {
        now: Date.now(), lastCheck: st.current.lastCheck, resumed, dismissed,
        found: st.current.found?.version ?? null, ready: st.current.ready,
        metered: net.metered, online: net.online, busy: st.current.busy,
      }
      const act = otaDecide(s)
      if (act === 'check') {
        st.current.lastCheck = Date.now()
        const u = await checkApkUpdate(__APP_VERSION__)
        if (!alive) return
        st.current.found = u
        setUpd(u)
        // Скачанное от прошлой версии уже не поставится — забываем о нём, чтобы
        // карточка не обещала мгновенную установку не той версии.
        if (otaStale(st.current.ready, u?.version ?? null)) { st.current.ready = null; setReady(null) }
        if (u) tick(false)   // сразу решаем, качать ли
        return
      }
      if (act === 'download' && st.current.found) {
        st.current.busy = true
        try {
          await downloadApk(st.current.found.url, st.current.found.version)
          if (!alive) return
          st.current.ready = st.current.found.version
          setReady(st.current.found.version)
        } catch { /* тихо: не вышло сейчас — попробуем на следующей проверке */ }
        finally { st.current.busy = false }
      }
    }

    // Что уже лежит на диске с прошлого раза.
    readyApkVersion().then(v => { if (alive) { st.current.ready = v; setReady(v) } })
    tick(false)
    const t = setInterval(() => tick(false), 15 * 60 * 1000)
    // В WebView возврат из фона приходит как visibilitychange — отдельного
    // пакета @capacitor/app ради этого не нужно.
    const onVis = () => { if (document.visibilityState === 'visible') tick(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [dismissed])

  const card = otaBanner({
    now: Date.now(), lastCheck: 0, resumed: false, dismissed,
    found: upd?.version ?? null, ready, metered: false, online: true, busy: false,
  })
  if (!card || !upd) return null
  return (
    <div className="upd-card">
      <div className="upd-ico"><Icon name="download" size={18} /></div>
      <div className="upd-tx">
        <b>Доступно обновление — v{card.version}</b>
        <span>{card.ready ? 'Уже скачано — осталось подтвердить установку' : 'Скачается само по Wi-Fi, или нажми «Обновить»'}</span>
        {/* v1.457.0: Android отказывается ставить обновление поверх, если оно
            подписано другим ключом, и говорит про «конфликт с другим пакетом».
            До v1.457.0 сборка молча подписывала каждую версию одноразовым
            ключом — значит один раз переустановить придётся всем. Молчать об
            этом нельзя: человек видит отказ системы и не понимает, что делать. */}
        {card.ready && <span className="upd-note">
          Если система напишет «конфликтует с другим пакетом» — удали старую версию и поставь заново.
          Это разово: следующие обновления встанут поверх.
        </span>}
      </div>
      {/* v1.308.0: ставим прямо в приложении. Если что-то пошло не так — тихо
          откатываемся на прежнее поведение, обычную ссылку: хуже, чем было, не станет. */}
      {pct === null
        ? <button className="upd-go" onClick={async () => {
            try {
              if (card.ready) return await installReadyApk()
              setPct(0)
              await installApkInApp(upd.url, setPct, upd.version)
            } catch (e: any) {
              setPct(null)
              toastErr(e?.message ?? 'Не удалось обновить — открываю страницу загрузки')
              if (!card.ready) openSafely(upd.url)
            }
          }}>{card.ready ? 'Установить' : 'Обновить'}</button>
        : <span className="upd-pct">{pct}%</span>}
      <button className="upd-x" title="Скрыть" onClick={() => { dismissApkVersion(card.version); setDismissed(card.version) }}><Icon name="close" size={14} /></button>
    </div>
  )
}

// Карточка авто-обновления (v1.29.0): живой прогресс скачивания, по готовности —
// кнопка «Перезапустить». Вместо системных немых уведомлений.
// v1.222.0: карточку можно свернуть к краю экрана (стрелка сбоку) вместо полного
// скрытия — если сейчас не до перезапуска, она «заползает в стену», оставляя
// маленький хвостик-ползунок; клик по нему возвращает карточку обратно.
function UpdateBanner() {
  const [u, setU] = useState<{ state: string; percent?: number; version?: string } | null>(null)
  const [hidden, setHidden] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const d = (window as any).neylivoDesktop
    if (!d?.onUpdate) return
    d.onUpdate((data: any) => {
      if (data?.state === 'error') { setU(null); return }   // v1.47.1: ошибка — тихо убираем карточку
      setU(prev => ({ ...(prev ?? { state: 'downloading' }), ...data }))
      if (data?.state === 'ready') setHidden(false)
    })
  }, [])
  if (!u || hidden) return null
  const pct = Math.max(0, Math.min(100, Math.round(u.percent ?? 0)))
  const ready = u.state === 'ready'
  return (
    <>
      <div className={'upd-card' + (ready ? ' ready' : '') + (collapsed ? ' collapsed' : '')}>
        <div className="upd-ico"><Icon name={ready ? 'rotate' : 'download'} size={18} /></div>
        <div className="upd-tx">
          <b>{ready ? 'Обновление готово' : 'Скачиваем обновление'}{u.version ? ' — v' + u.version : ''}</b>
          {ready
            ? <span>Перезапусти NeyLivo, чтобы применить</span>
            : <><span>{pct}%</span><div className="upd-bar"><i style={{ width: pct + '%' }} /></div></>}
        </div>
        {ready && <button className="upd-go" onClick={() => (window as any).neylivoDesktop?.applyUpdate?.()}>Перезапустить</button>}
        <button className="upd-collapse" title="Свернуть к краю" onClick={() => setCollapsed(true)}><Icon name="chevron-right" size={14} /></button>
        <button className="upd-x" title="Скрыть" onClick={() => setHidden(true)}><Icon name="close" size={14} /></button>
      </div>
      <button className={'upd-handle' + (collapsed ? ' show' : '')} title="Обновление отложено — показать" onClick={() => setCollapsed(false)}>
        <Icon name={ready ? 'rotate' : 'download'} size={16} />
      </button>
    </>
  )
}

// v1.272.0: устойчивый клиент — когда несколько запросов подряд к Supabase
// проваливаются (см. netStatus.ts), список серверов/друзей/каналов остаётся
// последним известным (из кэша), а не тихо становится пустым — но пользователь
// должен понимать ПОЧЕМУ ничего не обновляется, а не решить, что приложение
// сломано. Тонкая полоска сверху, не блокирует работу с уже загруженным.
function NetStatusBanner({ onOpenEmergency }: { onOpenEmergency: () => void }) {
  const degraded = useNetDegraded()
  const forMs = useNetDegradedForMs()
  if (!degraded) return null
  const long = forMs >= EMERGENCY_SUGGEST_MS
  return (
    <div className="net-banner">
      Нет связи с сервером — показываю последнее сохранённое, часть действий пока не сработает
      {long && <button className="net-banner-ec" onClick={onOpenEmergency}>🚨 Открыть аварийный чат</button>}
    </div>
  )
}

// v1.56.0: своя шапка вместо нативной рамки Windows — стрелки назад/вперёд слева,
// название раздела по центру, справа иконки и свои кнопки окна (как в Discord).
// Нативный titleBarOverlay убран (рисовался поверх приложения и ломался).
function Titlebar() {
  const [nav, setNav] = useState<{ title: string; canBack: boolean; canForward: boolean }>({ title: '', canBack: false, canForward: false })
  const [max, setMax] = useState(false)
  useEffect(() => {
    const h = (e: any) => setNav(e.detail)
    window.addEventListener('ponoi-nav-state', h as any)
    window.dispatchEvent(new Event('ponoi-nav-request'))
    const d = (window as any).neylivoDesktop
    d?.onMaximize?.((m: boolean) => setMax(m))
    return () => window.removeEventListener('ponoi-nav-state', h as any)
  }, [])
  const wc = () => (window as any).neylivoDesktop
  return (
    <header className="titlebar">
      <div className="tb-nav">
        <button className="tb-arrow" disabled={!nav.canBack} title="Назад"
          onClick={() => window.dispatchEvent(new Event('ponoi-nav-back'))}><Icon name="arrow-left" size={18} /></button>
        <button className="tb-arrow" disabled={!nav.canForward} title="Вперёд"
          onClick={() => window.dispatchEvent(new Event('ponoi-nav-forward'))}><Icon name="arrow-right" size={18} /></button>
      </div>
      <div className="tb-title">{nav.title}</div>
      <div className="tb-right">
        <button className="tb-ico" title="Быстрый переход (Ctrl+K)"
          onClick={() => window.dispatchEvent(new Event('ponoi-open-qs'))}><Icon name="search" size={16} /></button>
        <div className="tb-winctrls">
          <button className="tb-win" title="Свернуть" onClick={() => wc()?.winMinimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor" /></svg>
          </button>
          <button className="tb-win" title={max ? 'Восстановить' : 'Развернуть'} onClick={() => wc()?.winToggleMax?.()}>
            {max
              ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="2.5" width="6" height="6" /><path d="M2.5 2.5V0.5H9.5V7.5H7.5" /></svg>
              : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>}
          </button>
          <button className="tb-win tb-close" title="Закрыть" onClick={() => wc()?.winClose?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><path d="M1 1l8 8M9 1l-8 8" /></svg>
          </button>
        </div>
      </div>
    </header>
  )
}

// v1.116.0: окно «Что нового» — открывается тройным кликом по версии в правом нижнем углу.
function ChangelogModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ChangelogEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let ok = true
    import('./lib/changelog')
      .then(m => { if (ok) setList(m.CHANGELOG) })
      .catch(() => { if (ok) setFailed(true) })
    return () => { ok = false }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="chlog-overlay" onClick={onClose}>
      <div className="chlog" onClick={e => e.stopPropagation()}>
        <div className="chlog-head">
          <div>
            <div className="chlog-title">Что нового <span className="beta-tag" title="NeyLivo сейчас в бета-тестировании — возможны баги">БЕТА</span></div>
            <div className="chlog-sub">История обновлений NeyLivo — все версии пока бета</div>
          </div>
          <button className="chlog-x" title="Закрыть" onClick={onClose}><Icon name="close" size={18} /></button>
        </div>
        <div className="chlog-body">
          {failed && <div className="chlog-ver">Не удалось загрузить историю обновлений — нет связи.</div>}
          {!failed && !list && <div className="chlog-ver">Загружаю историю…</div>}
          {(list ?? []).map(v => (
            <div key={v.version} className="chlog-ver">
              <div className="chlog-ver-h">
                <span className="chlog-badge">v{v.version}</span>
                <span className="beta-tag">бета</span>
                {v.version === __APP_VERSION__ && <span className="chlog-cur">текущая</span>}
                <span className="chlog-date">{v.date}</span>
              </div>
              <ul className="chlog-list">
                {v.items.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// v1.137.0: правый клик по кастом-эмодзи в любом сообщении (сервер/ЛС) — меню
// «В избранное». Слушает событие 'ponoi-emoji-ctx' из рендерера сообщений (md.tsx).
function EmojiCtxHost() {
  const { user } = useAuth()
  const [ctx, setCtx] = useState<{ name: string; x: number; y: number } | null>(null)
  const [, setVer] = useState(0)
  useEffect(() => {
    const h = (e: any) => setCtx(e.detail)
    const h2 = () => setVer(v => v + 1)
    window.addEventListener('ponoi-emoji-ctx', h as any)
    window.addEventListener('ponoi-emoji-favs', h2)
    return () => { window.removeEventListener('ponoi-emoji-ctx', h as any); window.removeEventListener('ponoi-emoji-favs', h2) }
  }, [])
  const clamp = useClampToViewport(ctx?.x ?? 0, ctx?.y ?? 0)
  if (!ctx || !user) return null
  const fav = loadFavs().has(ctx.name)
  return <>
    <div className="ep2-ctx-ov" onClick={() => setCtx(null)} onContextMenu={e => { e.preventDefault(); setCtx(null) }} />
    <div className="ep2-ctx" ref={clamp.ref} style={clamp.style}>
      <button onClick={async () => { const added = await toggleFav(user.id, ctx.name); toastOk(added ? ':' + ctx.name + ': — в избранном, ищи в пикере под звёздочкой' : ':' + ctx.name + ': убран из избранного'); setCtx(null) }}>
        <Icon name="star" size={14} /> {fav ? 'Убрать из избранного' : 'В избранное'}
      </button>
    </div>
  </>
}

export default function App() {
  const { session, loading } = useAuth()
  // v1.161.0: диплинк neylivo://msg/... — приложение было открыто/поднято таким URL
  // (десктоп, см. electron/main.cjs). Разбираем и переходим к сообщению.
  useEffect(() => { (window as any).neylivoDesktop?.onDeepLink?.((url: string) => openMsgLink(url)) }, [])
  // v1.286.0: поднимаем включённые плагины один раз при старте. Плагины ставятся на
  // устройство, а не на аккаунт, поэтому сессия для этого не нужна — они работают и
  // на экране входа (свои темы оформления, например).
  useEffect(() => { void startEnabledPlugins() }, [])
  // v1.536.0: устройство отмечается при запуске — «я здесь».
  //
  // Отдельной кнопки «запомнить это устройство» нет намеренно: защита должна
  // работать, ничего не спрашивая. Первая отметка создаёт запись, и с этого мига
  // считаются сутки, в которые новому устройству закрыто опасное.
  //
  // Молча ловим отказ: у того, кто ещё не применил миграцию, приложение обязано
  // работать как раньше, а не встречать человека ошибкой на пустом месте.
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser()
        const me = data.user?.id
        if (me) await touchDevice(me)
      } catch { /* нет миграции или нет сети — не беда */ }
    })()
  }, [])
  // v1.511.0: приложение следит за тем, видно ли его. Вместе с признаком «идёт
  // игра» (его приносит рабочий стол, см. presence.tsx) это и включает бережный
  // режим: пока человек в игре, а окно позади, приложение перестаёт считать
  // кадры и реже стучится в сеть. Вернулись в окно — всё как было, немедленно.
  //
  // Слушаем ОБА признака: свёрнутое окно даёт visibilitychange, а окно, которое
  // просто ушло за игру, — только потерю фокуса.
  useEffect(() => {
    const обновить = () => updateGameState({
      visible: document.visibilityState === 'visible',
      focused: document.hasFocus(),
      enabled: getSettings().saveWhileGaming !== false,
    })
    обновить()
    document.addEventListener('visibilitychange', обновить)
    window.addEventListener('focus', обновить)
    window.addEventListener('blur', обновить)
    return () => {
      document.removeEventListener('visibilitychange', обновить)
      window.removeEventListener('focus', обновить)
      window.removeEventListener('blur', обновить)
    }
  }, [])
  // v1.443.0: экранная клавиатура на телефоне. Держим её высоту в --kb, чтобы
  // поле ввода не оставалось под клавиатурой, и рассылаем событие — переписка
  // по нему подкручивает список, если человек читал именно низ.
  // Только на телефоне: на десктопе visualViewport меняется от масштаба
  // страницы, и вёрстка дёргалась бы на ровном месте.
  useEffect(() => {
    if (!IS_MOBILE) return
    return watchKeyboard((px, prev) => {
      window.dispatchEvent(new CustomEvent('ponoi:kb', { detail: { px, prev } }))
    })
  }, [])
  // v1.116.0: три быстрых клика по версии — окно «Что нового»
  const [showLog, setShowLog] = useState(false)
  // v1.275.0: доступен даже если сам основной вход/сессия не грузится (loading
  // может зависнуть именно из-за той же недоступности Supabase) — поэтому
  // рендерится вне {loading ? ... : ...} ниже, а не только внутри Home.
  const [showEmergency, setShowEmergency] = useState(false)
  // v1.345.0: аварийный режим плагинов.
  //
  // Плагину с разрешением на оформление ничто не мешает закрыть приложение
  // непрозрачным слоем или спрятать половину интерфейса — и тогда до настроек,
  // чтобы его выключить, человек не доберётся. Значит нужен выход, который НЕ
  // требует ничего нажимать внутри приложения: адрес ?safe=1 и сочетание
  // Ctrl+Shift+Alt+P. Выбор запоминается, поэтому переживает перезагрузку.
  const [safe, setSafe] = useState(() => pluginsDisabled())
  useEffect(() => {
    try {
      if (new URLSearchParams(location.search).get('safe') === '1' && !pluginsDisabled()) {
        setPluginsDisabled(true); setSafe(true)
      }
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey || !e.altKey) return
      if (e.code !== 'KeyP') return
      e.preventDefault()
      const next = !pluginsDisabled()
      setPluginsDisabled(next)
      setSafe(next)
      // Плагины запускаются один раз при старте — обратно поднимаем перезагрузкой.
      if (!next) location.reload()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // v1.467.0: плагины узнают, активно ли окно.
  //
  // Зачем это по-настоящему. Плагин с холстом крутит анимацию кадр за кадром. В
  // свёрнутом окне это чистая трата батареи — а узнать о том, что на него никто
  // не смотрит, ему было неоткуда. Событие canvas говорит только про свою
  // панель, а это — про всё приложение целиком.
  //
  // Слушаем и focus/blur, и видимость вкладки: в браузере окно можно оставить
  // «активным» и уйти на другую вкладку, а в десктопной сборке наоборот.
  // Смена темы приходит обычным событием окна (см. settings.tsx): передаём её
  // плагинам здесь — в одном месте с остальными системными событиями.
  useEffect(() => {
    const наТему = (e: Event) => emitPluginEvent('theme', (e as CustomEvent).detail ?? {})
    window.addEventListener('ponoi-theme', наТему)
    return () => window.removeEventListener('ponoi-theme', наТему)
  }, [])

  useEffect(() => {
    let было: boolean | null = null
    const сказать = () => {
      const активно = document.visibilityState === 'visible' && document.hasFocus()
      if (активно === было) return   // не будим плагины на каждый чих
      было = активно
      emitPluginEvent('focus', { focused: активно })
    }
    window.addEventListener('focus', сказать)
    window.addEventListener('blur', сказать)
    document.addEventListener('visibilitychange', сказать)
    return () => {
      window.removeEventListener('focus', сказать)
      window.removeEventListener('blur', сказать)
      document.removeEventListener('visibilitychange', сказать)
    }
  }, [])

  // v1.419.0: горячие клавиши плагинов.
  //
  // Слушатель один на приложение и читает реестр в момент нажатия: плагины
  // приходят и уходят, и переподписываться на каждое их движение незачем.
  // Сочетание обязано быть с двумя модификаторами (проверяет okCombo в
  // registry.ts) — поэтому обычный набор текста сюда не попадает и preventDefault
  // не отнимает у человека ни одной привычной клавиши.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pluginsDisabled()) return
      const combo = comboFromEvent(e)
      if (!isComboComplete(combo)) return
      const hit = getHotkeys().find(h => h.combo.toLowerCase() === combo.toLowerCase())
      if (!hit) return
      e.preventDefault()
      // v1.467.0: два вида клавиш, один разбор. Клавишу, выбранную человеком в
      // настройках плагина, нельзя звать как функцию — у неё её нет; ей уходит
      // событие. Ветка здесь одна и последняя: заведи мы для этого отдельный
      // обработчик, два списка спорили бы за одно сочетание.
      if (hit.settingsKey) emitToPlugin(hit.pluginId, 'keybind', { key: hit.settingsKey, combo: hit.combo })
      else if (hit.onPress) void invokePlugin(hit.pluginId, hit.onPress, [])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // v1.415.0: пока человек вводит пароль, основной экран уже подгружается
  // в фоне. Так вход остаётся быстрым, а паузы после нажатия «Войти» не
  // появляется: к этому моменту код обычно уже на месте. Ждём немного, чтобы
  // не отнимать сеть у самой страницы входа с её картинкой и шрифтами.
  useEffect(() => {
    if (session) return
    const t = window.setTimeout(() => { void import('./components/Home') }, 1200)
    return () => window.clearTimeout(t)
  }, [session])

  const verClicks = useRef<number[]>([])
  function verClick() {
    const now = Date.now()
    verClicks.current = [...verClicks.current.filter(t => now - t < 1200), now]
    if (verClicks.current.length >= 3) { verClicks.current = []; setShowLog(true) }
  }
  return <>
    {/* v1.471.0: области плагинов — окна, вкладки, полный экран. Здесь, в
        самом верху приложения: окно во весь экран не должно зависеть от того,
        какой экран открыт. Пока областей нет, не рисует ничего. */}
    <PluginApps />
    <Toasts />
    <ConfirmHost />
    {/* v1.475.0: окно-вопрос плагина. Рядом с ConfirmHost и по той же причине:
        оно обязано жить над всем приложением, а не в открытом чате — иначе
        плагин со своей страницы настроек спросить человека не мог бы. */}
    <PluginDialogHost />
    {/* v1.450.0: всё, что обязано лежать ПОВЕРХ всего, выносится порталом.
        Причина та же, из-за которой окно подтверждения пряталось под
        конструктором плагинов: оболочка приложения (#root, position: fixed) —
        это отдельный слой, и большой экран, вынесенный в страницу, рисуется
        поверх неё целиком, каким бы высоким ни был слой внутри. Плашка «нет
        связи» и предложение обновиться так же были не видны из настроек. */}
    <Portal>
      <EmojiCtxHost />
      {isDesktop && <UpdateBanner />}
      {isApkNative && <ApkUpdateBanner />}
    </Portal>
    {isDesktop && <TitlebarHeightVar />}
    {isDesktop && <Titlebar />}
    {/* А эта полоса — НЕ наложение: она обычная строка в колонке приложения и
        сдвигает содержимое вниз (.net-banner, flex: none). В портале она
        потеряла бы колонку и легла бы поверх — поэтому остаётся на месте. */}
    <NetStatusBanner onOpenEmergency={() => setShowEmergency(true)} />
    <div className="app-viewport">
      {loading ? <div className="center">Загрузка…</div> : !session ? <AuthScreen /> : <Home />}
    </div>
    {showEmergency && <EmergencyChat onClose={() => setShowEmergency(false)} />}
    {/* Плашка живёт поверх всего и своими стилями: плагин мог испортить общие. */}
    {safe && (
      <div className="safe-banner">
        <span>Плагины выключены аварийным режимом — оформление и кнопки от них не работают.</span>
        <button onClick={() => { setPluginsDisabled(false); location.reload() }}>Включить обратно</button>
      </div>
    )}
    {/* v1.59.0: текущая версия мелким шрифтом в правом нижнем углу.
        v1.231.0: NeyLivo сейчас в бета-тестировании — метка БЕТА рядом с версией
        везде, где она показывается (тут и в окне «Что нового»). */}
    <div className="app-ver" onClick={verClick} title="Три клика — что нового в NeyLivo">v{__APP_VERSION__} <span className="beta-tag">бета</span></div>
    {showLog && <ChangelogModal onClose={() => setShowLog(false)} />}
  </>
}
