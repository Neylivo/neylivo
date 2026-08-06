import { PLUGIN_EVENTS, PLUGIN_EVENT_NAMES, type InstalledPlugin, type Permission } from './types'
import { isFnRef, type FnRef } from './sandbox'
import { checkTarget, checkMethod, pickHeaders, normMethod, type NetTarget } from './netGuard'
import {
  NET_TIMEOUT_MS, NET_STREAM_MS, NET_STREAM_IDLE_MS,
} from './limits'
import {
  addCommand, addComposerButton, addMessageAction, addHotkey, okCombo, commandOwner, safeIcon,
  setPluginCss, setSettingsPage, setPanel, PANEL_SLOTS, addContextItem, CTX_TARGETS, getRegistry,
  addHeaderButton, setKeybind,
  type SettingsRow, type PanelSlot, type CtxTarget,
} from './registry'
// v1.465.0: семь новых возможностей — каждая своим файлом, здесь только ветка
// диспетчера и проверка разрешения. Так же, как netGuard: правила отдельно от
// транспорта, потому что проверять их надо отдельно.
import { packIpc } from './ipc'
import { addInterceptor } from './middleware'
import { takeOffscreen, canvasHeight } from './canvasHub'
import { openSocket, sendSocket, closeSocket } from './wsHub'
import { addTask, removeTask } from './background'
import { parseTheme, applyPluginTheme, clearPluginTheme } from './pluginTheme'
import { openApp, updateApp, closeApp, isMode, APP_MODES, appList, widgetOf, setWidgetOf, appGeometry, screenSize } from './apps'
import { registerService, unregisterService, findService, serviceMethods, checkName } from './services'
import { dbInsert, dbGet, dbAll, dbWhere, dbUpdate, dbRemove, dbCount, dbClear, dbTables, isOp, OPS } from './db'
// v1.473.0: свои файлы плагина и геймпады. Оба — то же разделение, что и
// раньше: правила и хранение отдельно, ветка диспетчера здесь.
import {
  assetPut, assetGet, assetInfo, assetList, assetRemove, assetClear, assetUrl,
  isAssetRef, assetRefName, checkAssetName, ASSET_PREFIX,
} from './assets'
import { readPads, watchGamepads } from './gamepads'
// v1.481.0: любой канал, а не только открытый.
import { anyRecent, anySend, anyChannels } from './anyChat'
import { askDialog, dialogRows } from './dialog'
import { musicBridge } from './musicApi'
import { chatBridge } from './chatApi'
import { pluginServers, pluginChannels, pluginOpen, pluginSetStatus, pluginGetStatus, pluginPlaySound, PLUGIN_SOUND_NAMES } from './appApi'
import { readStorage, writeStorage, deleteStorage, listStorage } from './store'
import { pluginLog } from './host'
import { VOICE_EFFECTS, activeEffect, isVoiceEffect, applyVoiceEffectSafe, rememberVoiceEffect, savedVoiceEffect } from '../voiceFx'

// v1.286.0: хостовая реализация всего, что плагин может вызвать. Единственное место,
// где решается «можно или нельзя»: в самой песочнице (bootstrap.ts) никаких проверок
// нет намеренно — там всё под контролем чужого кода, и обойти любую проверку оттуда
// было бы делом одной строчки.

/** Что API умеет делать «наружу» — подставляет приложение (см. host.ts). */
/**
 * Всё, что плагин вообще может позвать (v1.441.0).
 *
 * Список зафиксирован НАРОЧНО и проверяется отдельной проверкой. Смысл не в
 * documentation ради documentation: любая новая возможность обязана пройти через
 * этот список, а значит — через вопрос «а не действует ли она на других людей?».
 * Сейчас ни один метод не умеет: менять права на сервере, писать от чужого
 * имени, трогать чужие сообщения, менять чужие настройки. Единственная запись,
 * которую видят все, — music.add, и она спрашивает человека каждый раз.
 */
export const PLUGIN_METHODS = [
  // своё окружение, только чтение
  'me', 'channel', 'channels', 'servers', 'status.get', 'voice.current', 'voice.effects',
  // своё состояние
  'status.set', 'voice.setEffect', 'storage.get', 'storage.set', 'storage.remove', 'storage.keys', 'storage.clear',
  // то, что человек и так делает кнопками у себя
  'messages.recent', 'messages.send', 'messages.react', 'messages.remove',
  'music.now', 'music.library', 'music.play', 'music.pause', 'music.next', 'music.prev', 'music.queue',
  'music.add',                       // единственная общая запись — со спросом
  'sound.play', 'clipboard.write', 'open', 'notify', 'log', 'net.fetch', 'net.stream', 'subscribe',
  // свой интерфейс
  'commands.register', 'ui.addComposerButton', 'ui.addMessageAction', 'ui.addPanel',
  'ui.addSettingsPage', 'ui.addHotkey', 'ui.confirm', 'ui.prompt',
  // строки описания панели
  'label', 'text', 'button', 'toggle', 'select', 'slider', 'color', 'image', 'progress', 'css', 'canvas',
  // v1.465.0. Ни одна из этих семи не действует на других людей:
  //   plugins.send    — письмо соседнему плагину на этом же устройстве;
  //   messages.on*    — правка СВОИХ сообщений и того, что человек видит у себя;
  //   ui.getCanvas    — свой холст в своей же панели;
  //   net.ws*         — свой сокет на объявленный домен, теми же правилами;
  //   background.*    — свой таймер, видимый человеку и им же выключаемый;
  //   ui.setTheme     — цвета у себя на экране;
  //   ui.addContextMenu — свой пункт в своём меню.
  'plugins.send', 'messages.onBeforeSend', 'messages.onBeforeRender',
  'ui.getCanvas', 'net.ws', 'net.wsSend', 'net.wsClose',
  'background.every', 'background.stop', 'ui.setTheme', 'ui.clearTheme', 'ui.addContextMenu',
  // v1.467.0. Точки монтирования и настройки одним объявлением:
  //   ui.addHeaderButton       — своя кнопка в шапке, видна на любом экране;
  //   settings.registerSchema  — страница настроек собирается приложением;
  //   keybind                  — вид строки, не метод (см. ROW_TYPES).
  'ui.addHeaderButton', 'settings.registerSchema', 'keybind',
  // v1.471.0: своя область экрана. Действует только на экран самого человека:
  // ни другим людям, ни серверу от неё ничего не достаётся.
  'apps.create', 'apps.update', 'apps.close',
  // v1.485.0: своё окно видно плагину — место, размер, экран.
  'apps.where', 'apps.all', 'apps.screen',
  // v1.487.0: спрятать окно и показать снова. Не закрытие: содержимое и холст
  // остаются живыми, иначе «спрятал на секунду» стоило бы плагину всей картинки.
  'apps.hide', 'apps.show',
  // v1.472.0: плагин как библиотека для других плагинов. Наружу это не выходит
  // никуда: вызов ходит между двумя воркерами на этом же устройстве.
  'services.register', 'services.unregister', 'services.connect', 'services.call',
  // v1.472.0: своё хранилище таблицами. Данные плагина и только его: имя
  // плагина входит в ключ и подставляется здесь, а не приходит от него.
  'db.insert', 'db.get', 'db.all', 'db.where', 'db.update', 'db.remove',
  'db.count', 'db.clear', 'db.tables',
  // v1.473.0: свои файлы. Лежат на устройстве человека, видны только своему
  // плагину, и ССЫЛКИ на них наружу не уходит — плагин знает только имя.
  'assets.put', 'assets.fetch', 'assets.get', 'assets.info', 'assets.list',
  'assets.remove', 'assets.clear', 'assets.play',
  // v1.473.0: геймпад. Только чтение устройства, которое человек воткнул сам.
  'input.gamepads',
  // v1.475.0: своё окно-вопрос. Форма из тех же строк, что панель; ответ —
  // значения полей, и ничего больше.
  'ui.dialog', 'messages.readState',
  // v1.481.0: любой канал — самое сильное, что есть у плагинов.
  'messages.anyList', 'messages.anyRecent', 'messages.anySend',
  // v1.475.0: перехват вложений — своё разрешение, помеченное опасным.
  'messages.onUpload',
] as const

/**
 * Обработчики фоновых задач (v1.465.0).
 *
 * Задача живёт в background.ts — там сроки и догон, и там нет и не должно быть
 * ни песочницы, ни меток функций. Метка обработчика лежит здесь, а зовёт её
 * host.ts. Разделение то же, что и везде: правила отдельно от транспорта.
 */
export const taskHandlers = new Map<number, { pluginId: string; fn: FnRef }>()

/**
 * Строка-холст с таким ключом у этого плагина.
 *
 * Ищем и в панелях, и на странице настроек: холст рисуется в обоих местах, и
 * «объявил на своей странице — не работает» было бы ровно тем расхождением
 * между показом и действием, которое в этом проекте ломается чаще всего.
 */
function panelCanvasRow(pluginId: string, key: string): { height: number; где: 'panel' | 'app' } | null {
  const reg = getRegistry()
  // v1.474.0: и в СВОИХ ОКНАХ тоже. В v1.471.0 про окна плагина было написано
  // «содержимое описывается теми же строками, включая холст — через него и
  // делается всё живое», и это было неправдой: холст в окне здесь не искали, и
  // ui.getCanvas отвечал «не объявлен» на объявленный холст. То есть игру,
  // редактор и визуализатор — ровно то, ради чего окна и делались, — написать
  // было нельзя. Нашлось при попытке написать настоящий плагин с игрой.
  const везде: { pluginId: string; rows: SettingsRow[]; где: 'panel' | 'app' }[] = [
    ...[...reg.panels, ...reg.settingsPages].map(p => ({ ...p, где: 'panel' as const })),
    ...appList().map(a => ({ pluginId: a.pluginId, rows: a.rows, где: 'app' as const })),
  ]
  for (const p of везде) {
    if (p.pluginId !== pluginId) continue
    for (const r of p.rows) if (r.type === 'canvas' && r.key === key) return { height: r.height, где: p.где }
  }
  return null
}

export interface HostContext {
  /** v1.445.0: позвать обработчик плагина. Нужен потоку: куски ответа надо
   *  отдавать по мере поступления, а не одним значением в конце.
   *
   *  Необязателен потому, что этот же тип описывает контекст, который
   *  подставляет открытый чат (см. host.ts, claimHostContext): ему звать
   *  обработчики незачем, и требовать от него заглушку — лишний шум. Без
   *  него поток честно откажется работать, а не сделает вид. */
  invoke?: (ref: FnRef, args: unknown[]) => Promise<unknown>
  /** Отправить сообщение в открытый сейчас канал от имени пользователя. */
  sendMessage: (text: string) => Promise<void>
  /** Всплывающее уведомление. */
  toast: (text: string) => void
  /** Кто сейчас в приложении. null — ещё не вошли. */
  me?: () => { id: string; name: string } | null
  /** Какой канал открыт. null — никакой (например, открыты настройки). */
  channel?: () => { id: string; name: string; serverId: string | null; serverName: string | null } | null
  /**
   * v1.477.0: докуда дочитал собеседник в ОТКРЫТОМ личном разговоре.
   * Подставляет экран личных сообщений; в канале и без разговора — null.
   */
  readState?: () => Promise<{ at: number | null; seenLabel: string | null; on: boolean } | null>
  /** Спросить у человека «да/нет». Возвращает его ответ. */
  confirm?: (title: string, text: string, ok: string) => Promise<boolean>
  /** Спросить строку. null — человек отказался. */
  prompt?: (title: string, placeholder: string, value: string) => Promise<string | null>
  /**
   * v1.465.0: передать письмо другому плагину. Подставляет host.ts — там живут
   * песочницы. Возвращает false, если адресат не запущен или не просил ipc:
   * плагин должен видеть, что письмо не дошло, а не считать, что дошло.
   */
  ipcSend?: (from: string, to: string, event: string, data: unknown) => boolean

  /**
   * v1.472.0: позвать обработчик В ДРУГОМ плагине. Нужно службам: вызов идёт из
   * одного плагина, а выполняется в другом.
   *
   * Отдельно от invoke, который зовёт обработчик СВОЕГО плагина: перепутать эти
   * два — значит позвать чужую функцию в своей песочнице, где её нет.
   */
  invokeIn?: (pluginId: string, ref: FnRef, args: unknown[]) => Promise<unknown>
}

/** Сколько ждём ответа от чужого сайта и сколько байт согласны принять. */
// v1.445.0: обычному запросу десяти секунд хватало, а вот ИИ-модели отвечают
// дольше — двадцать-шестьдесят секунд для генерации это норма. Пока предел был
// общий и равнялся десяти, встроить в плагин свою модель было нельзя в
// принципе: запрос обрывался раньше, чем приходил ответ.
// v1.446.0: все числа — в src/lib/plugins/limits.ts, одной таблицей.

class Denied extends Error {}

// v1.489.0: ограничения частоты здесь больше нет.
//
// Оно жило тут с v1.345.0 и считало по скользящему окну, сколько раз плагин
// успел отправить, отреагировать, сходить в интернет. Владелец сказал: «убери
// полностью все ограничение плагинов» — и это ровно оно.
//
// Чем это отличается от сроков ожидания, которые остались (limits.ts): те
// стерегут, чтобы не ответивший плагин не повесил ПРИЛОЖЕНИЕ. А здесь считалось
// то, сколько плагину можно, — этого больше нет нигде.

/**
 * Строка от плагина. Пустую не принимаем — это почти всегда его же ошибка, и
 * молча подставить вместо неё пустое место значит спрятать ошибку от автора.
 *
 * v1.489.0: длину БОЛЬШЕ НЕ РЕЖЕМ. Второй параметр остался только затем, чтобы
 * не переписывать полсотни вызовов; он ни на что не влияет. Подпись кнопки в
 * тысячу знаков — дело плагина и того, кто его поставил.
 */
function str(v: unknown, _max: number, what: string): string {
  const s = String(v ?? '').trim()
  if (!s) throw new Denied(`${what}: пустое значение`)
  return s
}

function fnRef(v: unknown, what: string): FnRef {
  if (!isFnRef(v)) throw new Denied(`${what}: ожидалась функция-обработчик`)
  return v
}

/** Строка настроек от плагина — приходит как чужие данные, поэтому пересобирается
 *  поштучно, а не пропускается как есть. */
function settingsRow(raw: any): SettingsRow | null {
  const key = String(raw?.key ?? '').slice(0, 60)
  const label = String(raw?.label ?? '').slice(0, 80)
  if (!key || !label) return null
  const description = raw?.description ? String(raw.description).slice(0, 200) : undefined
  switch (raw?.type) {
    case 'toggle': return { type: 'toggle', key, label, description, value: !!raw.value }
    case 'text': return { type: 'text', key, label, description, value: String(raw.value ?? '').slice(0, 500), placeholder: raw.placeholder ? String(raw.placeholder).slice(0, 60) : undefined }
    case 'select': {
      const options = Array.isArray(raw.options)
        ? raw.options.slice(0, 30).map((o: any) => ({ value: String(o?.value ?? ''), label: String(o?.label ?? '').slice(0, 60) })).filter((o: any) => o.value)
        : []
      return options.length ? { type: 'select', key, label, description, value: String(raw.value ?? ''), options } : null
    }
    case 'button': return isFnRef(raw.onClick) ? { type: 'button', key, label, description, onClick: raw.onClick } : null
    // v1.419.0: строки, которые ПОКАЗЫВАЮТ. Числа приводятся к своим границам
    // здесь, а не в разметке: панель с value = 10^9 не должна уметь растянуть
    // экран, а слайдер с min больше max — стать неподвижным.
    case 'label': return { type: 'label', key, label, description, value: String(raw.value ?? '').slice(0, 200) }
    // v1.465.0: холст. Высота зажимается здесь же — панель с высотой в миллион
    // пикселей не должна уметь вытолкнуть с экрана всё остальное.
    case 'canvas': return { type: 'canvas', key, label, description, height: canvasHeight(raw.height) }
    // v1.467.0: сочетание клавиш, которое выбирает человек. Кривое значение не
    // отбрасываем вместе со строкой — строка нужна, чтобы человек мог назначить
    // клавишу заново; просто показываем её пустой.
    case 'keybind': {
      const v = String(raw.value ?? '').trim()
      return { type: 'keybind', key, label, description, value: okCombo(v) ? v : '' }
    }
    case 'progress': return { type: 'progress', key, label, description, value: num(raw.value, 0, 100, 0) }
    case 'slider': {
      const min = num(raw.min, -1e6, 1e6, 0)
      const max = num(raw.max, -1e6, 1e6, 100)
      if (!(max > min)) return null
      const step = Math.min(Math.max(num(raw.step, 0.0001, max - min, 1), 0.0001), max - min)
      return { type: 'slider', key, label, description, value: num(raw.value, min, max, min), min, max, step }
    }
    case 'color': {
      const v = String(raw.value ?? '').trim()
      return { type: 'color', key, label, description, value: /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#5865f2' }
    }
    case 'image': {
      // Только https: с data: и javascript: в src плагин рисовал бы в окне уже
      // не картинку. Тот же разбор, что у @icon в шапке (manifest.ts).
      const v = String(raw.value ?? raw.url ?? '').trim().slice(0, 500)
      // v1.473.0: свой файл — «asset:имя». Настоящего адреса здесь НЕТ и не
      // будет: его подставляет приложение при показе, для своего же плагина
      // (см. assets.ts, правило 2). Имя проверяем сразу, чтобы плагин узнал об
      // ошибке при постановке строки, а не увидел пустую рамку.
      if (isAssetRef(v)) {
        const имя = assetRefName(v)
        try { checkAssetName(имя) } catch { return null }
        return { type: 'image', key, label, description, value: ASSET_PREFIX + имя }
      }
      let u: URL
      try { u = new URL(v) } catch { return null }
      if (u.protocol !== 'https:') return null
      return { type: 'image', key, label, description, value: v }
    }
    default: return null
  }
}

/** Число от плагина: не NaN, не бесконечность, всегда в своих границах. */
function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

export function createDispatcher(
  plugin: InstalledPlugin,
  ctx: HostContext,
  onSubscribe: (event: string) => void,
) {
  const id = plugin.manifest.id
  const perms = plugin.manifest.permissions

  function need(p: Permission) {
    if (!perms.includes(p)) {
      throw new Denied(`Плагину «${plugin.manifest.name}» не выдано разрешение «${p}» — добавь его в @permissions.`)
    }
  }

  return async function dispatch(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case 'log': {
        // Всегда можно: это отладочный вывод плагина, наружу он не уходит.
        // v1.397.0: и в журнал приложения тоже — консоль браузера есть не везде,
        // а на телефоне и в десктопной сборке её нет вовсе, то есть отладки не
        // было совсем.
        const lvl = args[1] === 'warn' || args[1] === 'error' ? args[1] : 'log'
        const text = String(args[0] ?? '').slice(0, 2000)
        console.info(`[плагин ${id}]`, text)
        pluginLog(id, lvl, text)
        return null
      }

      case 'css': {
        need('css')
        const css = String(args[0] ?? '')
        setPluginCss(id, css)
        return null
      }

      case 'ui.addComposerButton': {
        need('ui')
        const o = args[0] as any
        addComposerButton({
          pluginId: id,
          key: str(o?.key ?? o?.tooltip, 60, 'кнопка'),
          icon: safeIcon(o?.icon),
          tooltip: str(o?.tooltip, 0, 'подсказка кнопки'),
          onClick: fnRef(o?.onClick, 'кнопка композера'),
        })
        return null
      }

      case 'ui.addMessageAction': {
        need('ui')
        // Плюс messages.read: обработчик такого действия получает само сообщение
        // (автора и текст). Без этой проверки разрешение «добавлять кнопки» тихо
        // давало бы доступ к переписке в обход отдельного разрешения на чтение.
        need('messages.read')
        const o = args[0] as any
        addMessageAction({
          pluginId: id,
          key: str(o?.key ?? o?.label, 60, 'действие'),
          icon: safeIcon(o?.icon),
          label: str(o?.label, 0, 'подпись действия'),
          onClick: fnRef(o?.onClick, 'действие над сообщением'),
        })
        return null
      }

      case 'ui.addSettingsPage': {
        need('settings')
        const o = args[0] as any
        const rows = (Array.isArray(o?.rows) ? o.rows : []).slice(0, 50).map(settingsRow).filter(Boolean) as SettingsRow[]
        setSettingsPage({ pluginId: id, title: str(o?.title ?? plugin.manifest.name, 60, 'заголовок настроек'), rows })
        return null
      }

      // v1.417.0: своя панель в приложении. Строки те же, что у страницы
      // настроек, и рисует их приложение: плагин описывает, что показать, но
      // сам в окно не попадает — иначе песочница потеряла бы смысл.
      // v1.480.0: панель «в чат» больше не полоса над полем ввода — она
      // становится СВОБОДНЫМ ВИДЖЕТОМ. Плагины, написанные под slot: 'chat',
      // менять не нужно: приложение само открывает им виджет и обновляет его
      // теми же строками. Пропасть панель не может — она переезжает туда, куда
      // её поставит человек.
      case 'ui.addPanel': {
        need('panel')
        const o = args[0] as any
        const slot = String(o?.slot ?? '') as PanelSlot
        if (!(slot in PANEL_SLOTS)) {
          throw new Denied(`Неизвестное место «${slot}». Есть: ${Object.keys(PANEL_SLOTS).join(', ')}.`)
        }
        const rows = (Array.isArray(o?.rows) ? o.rows : []).slice(0, 20).map(settingsRow).filter(Boolean) as SettingsRow[]
        // Место 'chat' теперь означает «свой виджет»: одна штука на плагин,
        // повторный вызов её обновляет.
        const заголовок = str(o?.title ?? plugin.manifest.name, 40, 'заголовок панели')
        if (slot === 'chat') {
          const был = widgetOf(id)
          if (был !== undefined && updateApp(id, был, { title: заголовок, rows })) return null
          const w = openApp(id, { title: заголовок, mode: 'widget', icon: safeIcon(o?.icon), rows })
          setWidgetOf(id, w.id)
          return null
        }
        setPanel({ pluginId: id, slot, title: заголовок, rows })
        return null
      }

      // ── Музыка ──────────────────────────────────────────────────────────
      // Всё, что здесь есть, человек и так делает кнопками, а список Трекотеки
      // и так у него на экране. Самого звука плагину не достаётся: сюда не
      // попадает ни одна дорожка.
      case 'music.now': {
        need('music')
        return musicBridge()?.now() ?? null
      }
      case 'music.library': {
        need('music')
        return musicBridge()?.library() ?? []
      }
      case 'music.play': case 'music.pause': case 'music.next': case 'music.prev': {
        need('music')
        const b = musicBridge()
        if (!b) return false
        if (method === 'music.play') b.play()
        else if (method === 'music.pause') b.pause()
        else if (method === 'music.next') b.next()
        else b.prev()
        return true
      }
      case 'music.queue': {
        need('music')
        const b = musicBridge()
        if (!b) return false
        return b.queue(str(args[0], 60, 'номер трека'))
      }
      case 'music.add': {
        need('music')
        /**
         * v1.441.0: добавление в общий склад — только с разрешения человека.
         *
         * Это единственное место во всём API, где плагин пишет туда, что видят
         * ВСЕ: Трекотека общая. Ограничения по частоте тут мало — пять треков в
         * минуту это всё равно пять чужих песен в общем складе, которых никто не
         * просил. Теперь каждый такой трек подтверждается вручную, и отказ
         * молчаливый: плагин узнаёт только «не разрешили».
         *
         * Всё остальное, что плагин может, касается либо его самого, либо того,
         * что человек и так делает своими кнопками у себя (см. PLUGIN_METHODS
         * ниже — там же список и его смысл).
         */
        const b = musicBridge()
        if (!b) throw new Denied('Плеер сейчас не открыт — добавлять некуда.')
        const link = str(args[0], 500, 'ссылка на трек')
        if (!ctx.confirm) throw new Denied('Добавлять треки можно только с подтверждением.')
        const ok = await ctx.confirm(
          'Плагин добавляет трек',
          'Плагин «' + id + '» хочет добавить трек в общую Трекотеку — его увидят все.\n' + link,
          'Добавить',
        )
        if (!ok) throw new Denied('Человек не разрешил добавлять этот трек.')
        const why = await b.add(link)
        if (why) throw new Denied(why)
        return true
      }

      // v1.419.0: горячая клавиша. Единственный способ дать плагину управление
      // не там, где человек и так печатает.
      case 'ui.addHotkey': {
        need('ui')
        const o = args[0] as any
        const combo = str(o?.combo, 40, 'сочетание клавиш')
        if (!okCombo(combo)) {
          throw new Denied(`Сочетание «${combo}» не годится: нужны Ctrl или Alt и ещё один модификатор, например Ctrl+Shift+K.`)
        }
        addHotkey({
          pluginId: id,
          combo,
          description: str(o?.description ?? o?.label ?? combo, 80, 'описание сочетания'),
          onPress: fnRef(o?.onPress ?? o?.onClick, 'горячая клавиша'),
        })
        return null
      }

      // ── Открытый чат ────────────────────────────────────────────────────
      // Всё это делает не плагин, а сам экран чата — теми же обработчиками,
      // что и нажатие мышью, с теми же проверками прав канала (chatApi.ts).
      case 'messages.recent': {
        need('messages.read')
        const b = chatBridge(ctx.channel?.()?.id)
        if (!b) throw new Denied('Сейчас не открыт ни один чат — читать нечего.')
        // v1.489.0: потолка нет — сколько попросил, столько и отдадим.
        const n = Math.max(Math.round(Number(args[0]) || 20), 1)
        return b.recent(n)
      }
      case 'messages.react': {
        need('messages.write')
        const b = chatBridge(ctx.channel?.()?.id)
        if (!b) throw new Denied('Сейчас не открыт ни один чат.')
        const why = await b.react(str(args[0], 60, 'id сообщения'), str(args[1], 16, 'эмодзи'))
        if (why) throw new Denied(why)
        return true
      }
      case 'messages.remove': {
        need('messages.write')
        const b = chatBridge(ctx.channel?.()?.id)
        if (!b) throw new Denied('Сейчас не открыт ни один чат.')
        const why = await b.remove(str(args[0], 60, 'id сообщения'))
        if (why) throw new Denied(why)
        return true
      }

      // ── Приложение вокруг ───────────────────────────────────────────────
      case 'servers': {
        need('context')
        return await pluginServers()
      }
      case 'channels': {
        need('context')
        return await pluginChannels(str(args[0], 60, 'id сервера'))
      }
      case 'open': {
        need('navigate')
        // Переход уводит человека с того, на что он смотрит: в цикле это
        // сделало бы приложение неуправляемым.
        const o = (args[0] ?? {}) as any
        const ok = pluginOpen({
          serverId: o.serverId ? String(o.serverId).slice(0, 60) : undefined,
          channelId: o.channelId ? String(o.channelId).slice(0, 60) : undefined,
          dmId: o.dmId ? String(o.dmId).slice(0, 60) : undefined,
          userId: o.userId ? String(o.userId).slice(0, 60) : undefined,
          userName: o.userName ? String(o.userName).slice(0, 60) : undefined,
        })
        if (!ok) throw new Denied('Нечего открывать: нужен serverId, dmId или userId.')
        return true
      }

      case 'status.set': {
        need('status')
        return await pluginSetStatus(String(args[0] ?? ''))
      }
      case 'status.get': {
        need('status')
        return await pluginGetStatus()
      }

      case 'sound.play': {
        // Звук — то же беспокойство, что и уведомление, поэтому и разрешение то
        // же самое, и ограничение частоты своё.
        need('notify')
        const name = String(args[0] ?? 'chime')
        if (!(PLUGIN_SOUND_NAMES as readonly string[]).includes(name)) {
          throw new Denied(`Нет такого звука «${name}». Есть: ${PLUGIN_SOUND_NAMES.join(', ')}.`)
        }
        await pluginPlaySound(name)
        return true
      }

      case 'commands.register': {
        need('commands')
        // v1.475.0: команду можно завести и объектом — с доводами и подсказками.
        // Прежний вид (имя, описание, обработчик) продолжает работать: плагины,
        // написанные по старой инструкции, никуда не делись.
        const объект = args[0] && typeof args[0] === 'object' && !isFnRef(args[0])
        const o = (объект ? args[0] : {}) as any
        const name = str(объект ? o.name : args[0], 32, 'имя команды').toLowerCase().replace(/^\//, '')
        // Буквы ЛЮБОГО алфавита, не только латиница: приложение русскоязычное, и
        // /привет — ровно то, что человек напишет первым делом. Пробелы и знаки
        // по-прежнему нельзя: имя команды должно кончаться там же, где начинаются
        // её аргументы, иначе разбор строки станет неоднозначным.
        if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(name)) {
          throw new Denied('Имя команды: буквы, цифры, дефис и подчёркивание — без пробелов.')
        }
        const owner = commandOwner(name)
        // Команды глобальны: молча перехватить чужую — способ подменить поведение
        // другого плагина, поэтому конфликт виден плагину сразу как ошибка.
        if (owner && owner !== id) throw new Denied(`Команда /${name} уже занята другим плагином.`)
        addCommand({
          pluginId: id, name,
          description: str(объект ? o.description : args[1], 100, 'описание команды'),
          handler: fnRef(объект ? (o.onRun ?? o.handler) : args[2], 'команда'),
          // Доводы описываются данными, как и всё остальное: приложение по ним
          // рисует подсказку в поле ввода, а плагин получает разложенные
          // значения. Больше восьми — это уже не команда, а анкета.
          args: (Array.isArray(o.args) ? o.args : []).slice(0, 8).map((a: any) => ({
            name: str(a?.name, 24, 'имя довода'),
            description: String(a?.description ?? '').slice(0, 80),
            required: !!a?.required,
            placeholder: String(a?.placeholder ?? '').slice(0, 40),
            options: Array.isArray(a?.options)
              ? a.options.slice(0, 25).map((v: any) => ({
                  value: String(v?.value ?? v).slice(0, 60),
                  label: String(v?.label ?? v?.value ?? v).slice(0, 60),
                }))
              : undefined,
          })),
          // Подсказки на лету: приложение зовёт это, пока человек печатает.
          complete: o.onComplete && isFnRef(o.onComplete) ? (o.onComplete as FnRef) : undefined,
        })
        return null
      }

      case 'messages.send': {
        need('messages.write')
        // Человек пишет руками в лучшем случае несколько сообщений за десять
        // секунд — плагину столько же и хватит.
        await ctx.sendMessage(String(args[0] ?? '').slice(0, 4000))
        return null
      }

      case 'voice.setEffect': {
        need('voice')
        const raw = String(args[0] ?? 'none')
        if (!isVoiceEffect(raw)) throw new Denied(`Неизвестный эффект голоса «${str(raw, 30, 'эффект')}».`)
        // v1.337.0: выбор запоминается ВСЕГДА, даже когда звонка сейчас нет.
        // Раньше плагин мог выставить «голос по умолчанию», это никуда не
        // записывалось, и следующий звонок начинался с прежнего голоса —
        // настройка выглядела нерабочей.
        rememberVoiceEffect(raw)
        // v1.409.0: через ту же дорогу, что и кнопка в звонке. Раньше здесь
        // стояла setVoiceEffect, которая умеет только переключить УЖЕ собранную
        // цепочку обработки: если человек не трогал эффекты руками, цепочки не
        // было, и плагин получал false, не сделав ничего.
        // false — звонка сейчас нет; это не ошибка плагина, поэтому возвращаем
        // ответ, а не исключение: пусть сам решит, ругаться или промолчать.
        return await applyVoiceEffectSafe(raw)
      }
      case 'voice.effects': {
        need('voice')
        return VOICE_EFFECTS.map(e => ({ id: e.id, label: e.label }))
      }
      case 'voice.current': {
        need('voice')
        // Вне звонка активной цепочки нет — отвечаем сохранённым выбором, иначе
        // плагин всегда видел бы «Обычный» и рисовал бы неверную настройку.
        return activeEffect() !== 'none' ? activeEffect() : savedVoiceEffect()
      }

      case 'notify': {
        need('notify')
        ctx.toast(String(args[0] ?? '').slice(0, 200))
        return null
      }

      case 'storage.get': {
        need('storage')
        return readStorage(id, String(args[0] ?? '')) ?? null
      }
      case 'storage.set': {
        need('storage')
        const key = str(args[0], 100, 'ключ')
        let json: string
        try { json = JSON.stringify(args[1] ?? null) } catch { throw new Denied('Значение нельзя сохранить: в нём есть циклическая ссылка.') }
        writeStorage(id, key, JSON.parse(json))
        return null
      }
      case 'storage.remove': {
        need('storage')
        deleteStorage(id, str(args[0], 100, 'ключ'))
        return null
      }
      case 'storage.clear': {
        need('storage')
        // Своё и только своё: listStorage отдаёт ключи этого плагина.
        for (const k of listStorage(id)) deleteStorage(id, k)
        return null
      }

      case 'net.fetch': {
        need('net')
        // Запросы наружу — тоже поток: без потолка плагин превращается в
        // маленький ддос-клиент с чужого компьютера.
        return await pluginFetch(plugin, String(args[0] ?? ''), args[1] as any)
      }

      // v1.445.0: ответ по кускам, по мере поступления.
      //
      // Зачем. Своя ИИ-модель в плагине без этого не работает вовсе: обычный
      // запрос ждёт ВЕСЬ ответ целиком, а модель отвечает по слову и делает это
      // десятками секунд. Человек всё это время видел пустоту, а на десятой
      // секунде запрос ещё и обрывался по общему пределу.
      //
      // Правила выхода в сеть при этом ровно те же — они вынесены в netGuard.ts
      // и зовутся отсюда, а не переписаны заново.
      case 'net.stream': {
        need('net')
        return await pluginStream(plugin, String(args[0] ?? ''), args[1] as any,
          fnRef(args[2], 'net.stream: третьим доводом'), ctx)
      }

      // ---- v1.360.0: обстановка вокруг ------------------------------------
      // Плагину почти всегда нужно знать, от чьего имени он работает и куда
      // пишет: без этого нельзя ни поздороваться по имени, ни отличить свои
      // сообщения от чужих. Раньше не было никак.
      case 'me': {
        need('context')
        return ctx.me?.() ?? null
      }

      case 'channel': {
        need('context')
        return ctx.channel?.() ?? null
      }

      // ---- Спросить у человека --------------------------------------------
      // Плагин не имеет доступа к странице и своё окно нарисовать не может — и
      // не должен: тогда он смог бы подделать любое окно приложения. Поэтому
      // окно рисует приложение, а плагин получает только ответ.
      case 'ui.confirm': {
        need('ui')
        const o = (args[0] ?? {}) as any
        if (!ctx.confirm) return false
        return await ctx.confirm(
          str(o.title ?? 'Вопрос', 60, 'title'),
          String(o.text ?? '').slice(0, 300),
          str(o.ok ?? 'Да', 20, 'ok'),
        )
      }

      case 'ui.prompt': {
        need('ui')
        const o = (args[0] ?? {}) as any
        if (!ctx.prompt) return null
        return await ctx.prompt(
          str(o.title ?? 'Введи значение', 60, 'title'),
          String(o.placeholder ?? '').slice(0, 60),
          String(o.value ?? '').slice(0, 500),
        )
      }

      case 'clipboard.write': {
        need('ui')
        const t = String(args[0] ?? '').slice(0, 10_000)
        if (!t) throw new Denied('Нечего копировать.')
        await navigator.clipboard?.writeText(t)
        return true
      }

      case 'storage.keys': {
        need('storage')
        return listStorage(id)
      }

      case 'subscribe': {
        const ev = String(args[0] ?? '')
        // v1.397.0: разрешение берётся из таблицы событий (types.ts), а не из
        // списка условий здесь. Раньше проверка знала одно имя — 'message', — и
        // любое другое подписывалось молча и без всякого разрешения; сейчас
        // событий много, и такой список рано или поздно разошёлся бы с жизнью.
        // Неизвестное имя — отказ, а не тихая подписка в никуда: молчащий
        // обработчик разработчик ищет часами.
        const spec = PLUGIN_EVENTS[ev]
        if (!spec) {
          throw new Denied(`Неизвестное событие «${ev}». Есть: ${PLUGIN_EVENT_NAMES.join(', ')}.`)
        }
        if (spec.permission) need(spec.permission)
        onSubscribe(ev)
        // v1.473.0: геймпады опрашиваются кадрами и только пока их кто-то
        // слушает. Подписка — единственный момент, когда это известно.
        if (ev === 'gamepad') watchGamepads(id)
        return null
      }

      // ═══ v1.465.0 ═══════════════════════════════════════════════════════
      // Семь новых возможностей. Каждая внесена в PLUGIN_METHODS выше — то
      // есть прошла через вопрос «а кого это заденет, кроме самого человека».

      // ---- Разговор плагинов между собой (нужно ipc) ----------------------
      // Разрешение нужно ОБОИМ концам: здесь проверяется отправитель, у
      // получателя — при подписке на событие 'ipc' (таблица в types.ts).
      // Наружу это не выходит никуда: письмо ходит между двумя воркерами.
      case 'plugins.send': {
        need('ipc')
        const to = str(args[0], 80, 'plugins.send: id плагина')
        if (to === id) throw new Denied('Плагин не может слать письмо самому себе.')
        // packIpc вырезает метки функций: доехавшая метка дала бы соседу
        // кнопку, нажимающую чужой код с ЧУЖИМИ разрешениями (см. ipc.ts).
        const { event, data } = packIpc(args[1], args[2])
        if (!ctx.ipcSend) return false
        return ctx.ipcSend(id, to, event, data)
      }

      // ---- Перехват сообщений (нужно messages.intercept) ------------------
      // Самое сильное разрешение из всех: плагин видит каждое сообщение и
      // может отправить не то, что человек набрал. Поэтому оно отдельное и
      // помечено небезопасным — в одном списке с «писать от твоего имени» ему
      // было бы не место, это сильнее.
      case 'messages.onBeforeSend': {
        need('messages.intercept')
        addInterceptor({ pluginId: id, kind: 'send', fn: fnRef(args[0], 'onBeforeSend') })
        return null
      }
      case 'messages.onBeforeRender': {
        need('messages.intercept')
        addInterceptor({ pluginId: id, kind: 'render', fn: fnRef(args[0], 'onBeforeRender') })
        return null
      }

      // ---- Холст в панели или в своём окне (нужно panel либо apps) --------
      // Плагин получает не кусок страницы, а отдельный холст со своими
      // пикселями: прочитать через него окно нельзя, нарисовать за пределами
      // своей панели — тоже.
      case 'ui.getCanvas': {
        const key = str(args[0], 60, 'ui.getCanvas: ключ холста')
        // Высоту берём из объявленной строки, а не из довода: холст живёт в
        // панели или в окне плагина, и если их нет — показывать его негде.
        // Молча выдать холст, которого человек никогда не увидит, значит
        // соврать.
        const row = panelCanvasRow(id, key)
        if (!row) {
          throw new Denied(
            `Холст «${key}» не объявлен. Добавь строку { type: 'canvas', key: '${key}', height: 160 } в панель или в своё окно.`,
          )
        }
        // v1.474.0: разрешение спрашивается по тому, ГДЕ холст объявлен.
        // Требовать «свою панель в плеере и чате» от игры, у которой панели
        // нет вовсе, значило бы врать человеку на экране разрешений.
        need(row.где === 'app' ? 'apps' : 'panel')
        // Пометка «передать, а не копировать» — см. sandbox.ts, asTransfer.
        return { __transfer: takeOffscreen(id, key, row.height) }
      }

      // ---- Постоянное соединение (нужно net и @hosts) ---------------------
      // Проверка адреса — тем же checkTarget, что у обычного запроса, только
      // со схемой wss. Второго списка правил здесь нет намеренно.
      case 'net.ws': {
        need('net')
        const url = String(args[0] ?? '')
        const h = (args[1] ?? {}) as Record<string, unknown>
        if (!ctx.invoke) throw new Denied('Соединение недоступно: приложение не может звать обработчики плагина.')
        const invoke = ctx.invoke
        const зовём = (ref: unknown, a: unknown[]) => {
          if (isFnRef(ref)) void invoke(ref, a).catch(() => {})
        }
        return openSocket(id, url, netTarget(plugin), {
          onOpen: () => зовём(h.onOpen, []),
          onMessage: t => зовём(h.onMessage, [t]),
          onClose: (code, reason) => зовём(h.onClose, [code, reason]),
        })
      }
      case 'net.wsSend': {
        need('net')
        return sendSocket(id, Number(args[0]), args[1])
      }
      case 'net.wsClose': {
        need('net')
        return closeSocket(id, Number(args[0]))
      }

      // ---- Работа по расписанию (нужно background) ------------------------
      // Что это добавляет к обычному setInterval внутри плагина (он и раньше
      // работал) — четырьмя пунктами написано в background.ts. Коротко: задачу
      // видно человеку и он может её остановить.
      case 'background.every': {
        need('background')
        const ms = Number(args[0])
        const fn = fnRef(args[1], 'background.every: вторым доводом')
        const task = addTask(id, ms, String(args[2] ?? ''))
        taskHandlers.set(task.id, { pluginId: id, fn })
        return task.id
      }
      case 'background.stop': {
        need('background')
        const tid = Number(args[0])
        const ok = removeTask(id, tid)
        if (ok) taskHandlers.delete(tid)
        return ok
      }

      // ---- Цвета оформления (нужно ui.theme) ------------------------------
      // Не CSS: словарь имён из закрытого списка и только #rrggbb. Вёрстку
      // этим не сломать и чужое окно не подделать — в отличие от разрешения
      // css, ради которого в приложении держится аварийный режим.
      case 'ui.setTheme': {
        need('ui.theme')
        const colors = parseTheme(args[0])
        applyPluginTheme(id, colors)
        return true
      }
      case 'ui.clearTheme': {
        need('ui.theme')
        clearPluginTheme(id)
        return true
      }

      // ---- Пункт меню по правой кнопке (нужно ui) -------------------------
      case 'ui.addContextMenu': {
        need('ui')
        const o = args[0] as any
        const target = String(o?.target ?? '') as CtxTarget
        if (!(target in CTX_TARGETS)) {
          throw new Denied(`Неизвестное место «${target}». Есть: ${Object.keys(CTX_TARGETS).join(', ')}.`)
        }
        // Пункт в меню сообщения даёт обработчику само сообщение — значит,
        // сверх «добавлять кнопки» нужно ещё и разрешение на чтение. Ровно та
        // же связка, что у ui.addMessageAction: иначе «добавлять кнопки» тихо
        // открывало бы переписку в обход отдельного разрешения.
        if (target === 'message') need('messages.read')
        addContextItem({
          pluginId: id,
          key: str(o?.key ?? o?.label, 60, 'пункт меню'),
          target,
          icon: safeIcon(o?.icon),
          label: str(o?.label, 0, 'подпись пункта меню'),
          onClick: fnRef(o?.onClick, 'пункт меню'),
        })
        return null
      }

      // ---- Кнопка в шапке приложения (нужно ui) ---------------------------
      // Единственное место, видное на КАЖДОМ экране: и в канале, и в личке.
      // Всё остальное, откуда плагин получал управление, привязано к переписке.
      case 'ui.addHeaderButton': {
        need('ui')
        const o = args[0] as any
        addHeaderButton({
          pluginId: id,
          key: str(o?.key ?? o?.tooltip, 60, 'кнопка шапки'),
          icon: safeIcon(o?.icon),
          tooltip: str(o?.tooltip, 0, 'подсказка кнопки'),
          onClick: fnRef(o?.onClick, 'кнопка шапки'),
          active: !!o?.active,
        })
        return null
      }

      // ---- Настройки одним объявлением (нужно settings) --------------------
      //
      // Зачем, если есть ui.addSettingsPage. Тот принимает ГОТОВЫЕ строки: их
      // надо собрать руками, самому достать сохранённое значение из хранилища,
      // самому подставить значение по умолчанию при первом запуске и самому же
      // не забыть сделать это до первого обращения к настройке. На этом
      // спотыкается каждый второй плагин: настройка «есть», а до первого
      // касания человеком её значение undefined.
      //
      // Здесь плагин ОБЪЯВЛЯЕТ, чего хочет, а приложение само: подставляет
      // значения по умолчанию в хранилище, читает уже сохранённое, строит
      // страницу и назначает выбранные человеком клавиши. И сразу возвращает
      // текущие значения — чтобы плагин не гадал и не читал их по одному.
      case 'settings.registerSchema': {
        need('settings')
        const raw = Array.isArray(args[0]) ? args[0] : []
        const rows: SettingsRow[] = []
        const значения: Record<string, unknown> = {}
        for (const r of raw.slice(0, 50) as any[]) {
          const key = String(r?.key ?? '').trim().slice(0, 60)
          if (!key) continue
          const сохранено = readStorage(id, key)
          const поумолчанию = r?.default
          // Первый запуск: значение по умолчанию ложится в хранилище сразу, а не
          // «когда-нибудь потом». Ради этого всё и затевалось.
          if (сохранено === undefined && поумолчанию !== undefined) {
            writeStorage(id, key, поумолчанию)
          }
          const value = сохранено === undefined ? поумолчанию : сохранено
          const row = settingsRow({ ...r, key, label: r?.title ?? r?.label, value })
          if (!row) continue
          rows.push(row)
          значения[key] = 'value' in row ? (row as any).value : value
          // Строка keybind не просто показывает сочетание — приложение его
          // РЕГИСТРИРУЕТ. Иначе это была бы настройка, которая ничего не делает.
          if (row.type === 'keybind') {
            need('ui')
            setKeybind(id, key, String(row.value ?? ''))
          }
        }
        if (!rows.length) throw new Denied('settings.registerSchema: ни одной понятной строки')
        setSettingsPage({ pluginId: id, title: str(plugin.manifest.name, 60, 'заголовок настроек'), rows })
        return значения
      }

      // ---- Своя область экрана (нужно apps) -------------------------------
      //
      // Плавающее окно, вкладка, полный экран и картинка-в-картинке — это ОДНО
      // и то же с разным полем mode. Четыре отдельные возможности разошлись бы
      // между собой через пару версий; см. apps.ts, там про это подробно.
      //
      // Содержимое — те же строки, что в панели, включая холст: плагин
      // по-прежнему ничего не рисует сам. Даже во весь экран у окна остаётся
      // наша шапка с именем плагина и кнопкой закрытия — иначе «полный экран»
      // стал бы способом подделать приложение целиком.
      case 'apps.create': {
        need('apps')
        const o = args[0] as any
        const mode = String(o?.mode ?? 'window')
        if (!isMode(mode)) {
          throw new Denied(`Неизвестный вид окна «${mode}». Есть: ${Object.keys(APP_MODES).join(', ')}.`)
        }
        const rows = (Array.isArray(o?.rows) ? o.rows : []).slice(0, 40).map(settingsRow).filter(Boolean) as SettingsRow[]
        const app = openApp(id, {
          title: str(o?.title ?? plugin.manifest.name, 60, 'заголовок окна'),
          mode, icon: safeIcon(o?.icon), rows, w: o?.width, h: o?.height,
          // v1.479.0: окно настраивается гибко. Место и размер плагин
          // ПРЕДЛАГАЕТ — решает человек, и его решение помнится между
          // запусками (apps.ts). Растягивание можно запретить, если у плагина
          // всё нарисовано под один размер.
          x: o?.x, y: o?.y,
          resizable: o?.resizable,
          minW: o?.minWidth, minH: o?.minHeight,
          // v1.487.0: окно без нашей рамки и с прозрачной подложкой. Шапка при
          // этом не исчезает, а прячется до наведения (см. PluginApps.tsx и
          // styles.css) — иначе окно во весь экран без подписи и без крестика
          // стало бы способом подделать приложение и не дать себя закрыть.
          frameless: o?.frameless, transparent: o?.transparent, smooth: o?.smooth,
          // v1.490.0: настоящая страница внутри окна. Живёт в песочнице
          // браузера с непрозрачным происхождением — см. htmlFrame.ts.
          html: o?.html,
        })
        return app.id
      }
      case 'apps.update': {
        need('apps')
        const o = (args[1] ?? {}) as any
        const patch: Parameters<typeof updateApp>[2] = {}
        if (o.title !== undefined) patch.title = str(o.title, 60, 'заголовок окна')
        if (o.rows !== undefined) {
          patch.rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, 40).map(settingsRow).filter(Boolean) as SettingsRow[]
        }
        if (o.mode !== undefined) {
          if (!isMode(o.mode)) throw new Denied(`Неизвестный вид окна «${o.mode}».`)
          patch.mode = o.mode
        }
        if (o.width !== undefined) patch.w = o.width
        if (o.height !== undefined) patch.h = o.height
                if (o.x !== undefined) patch.x = o.x
        if (o.y !== undefined) patch.y = o.y
        if (o.resizable !== undefined) patch.resizable = o.resizable
        if (o.minWidth !== undefined) patch.minW = o.minWidth
        if (o.minHeight !== undefined) patch.minH = o.minHeight
        if (o.frameless !== undefined) patch.frameless = o.frameless
        if (o.transparent !== undefined) patch.transparent = o.transparent
        if (o.hidden !== undefined) patch.hidden = o.hidden
        if (o.smooth !== undefined) patch.smooth = o.smooth
        if (o.html !== undefined) patch.html = o.html
        return updateApp(id, Number(args[0]), patch)
      }
      // v1.487.0: спрятать и показать. Отдельными вызовами, а не только флагом
      // в update: «спрячь окно» — это одно действие, и писать его через
      // объект настроек значит прятать намерение за подробностями.
      case 'apps.hide':
      case 'apps.show': {
        need('apps')
        return updateApp(id, Number(args[0]), { hidden: method === 'apps.hide' })
      }
      // v1.485.0: где стоит окно и какой оно величины. Без этого плагин не мог
      // знать ничего о перетаскивании — окно уезжало, а он рисовал по старым
      // координатам.
      case 'apps.where': {
        need('apps')
        const g = appGeometry(id, Number(args[0]))
        if (!g) return null
        return {
          id: g.id, mode: g.mode, title: g.title,
          x: g.x, y: g.y, width: g.w, height: g.h,
          max: g.max, screenWidth: g.screenW, screenHeight: g.screenH,
          // v1.487.0: вид окна плагин тоже должен уметь прочитать — иначе
          // «переключи рамку» он может только вслепую, по своей памяти.
          frameless: g.frameless, transparent: g.transparent,
          hidden: g.hidden, resizable: g.resizable, smooth: g.smooth,
        }
      }
      case 'apps.all': {
        need('apps')
        // Через appGeometry, а не по модели напрямую: у неподвинутого окна x и
        // y в модели пустые (место ему задаёт вёрстка), и список выдавал бы
        // null там, где на экране стоит настоящий прямоугольник.
        return appList(id).map(a => {
          const g = appGeometry(id, a.id) ?? a
          return {
            id: a.id, mode: a.mode, title: a.title,
            x: g.x, y: g.y, width: g.w, height: g.h, max: a.max,
            frameless: a.frameless, transparent: a.transparent, hidden: a.hidden,
          }
        })
      }
      case 'apps.screen': {
        need('apps')
        return screenSize()
      }

      case 'apps.close': {
        need('apps')
        return closeApp(id, Number(args[0]))
      }

      // ---- Плагин как библиотека (нужно ipc) ------------------------------
      //
      // Разрешение то же, что у обмена письмами, и по той же причине: это
      // разговор двух плагинов на одном устройстве. Нужно ОБОИМ — тому, кто
      // предлагает, и тому, кто зовёт.
      //
      // Функции при регистрации никуда не едут: у приложения остаются метки, по
      // которым оно умеет позвать их обратно. Вызывающий получает не ссылку на
      // чужой код, а право попросить приложение позвать метод по имени.
      case 'services.register': {
        need('ipc')
        const name = checkName(args[0])
        const raw = (args[1] ?? {}) as Record<string, unknown>
        const methods = new Map<string, FnRef>()
        for (const [k, v] of Object.entries(raw)) {
          if (!isFnRef(v)) continue
          methods.set(String(k).slice(0, 60), v)
        }
        registerService(id, name, methods)
        return [...methods.keys()]
      }
      case 'services.unregister': {
        need('ipc')
        return unregisterService(id, String(args[0] ?? ''))
      }
      case 'services.connect': {
        need('ipc')
        // Отдаём только ИМЕНА методов: по ним вызывающий соберёт у себя объект.
        // Ни одной метки функции наружу не уходит.
        const names = serviceMethods(String(args[0] ?? ''))
        if (!names) throw new Denied(`Служба «${args[0]}» не найдена — плагин, который её предлагает, не запущен.`)
        return names
      }
      case 'services.call': {
        need('ipc')
        const svc = findService(String(args[0] ?? ''))
        if (!svc) throw new Denied(`Служба «${args[0]}» не найдена.`)
        const ref = svc.methods.get(String(args[1] ?? ''))
        if (!ref) throw new Denied(`У службы «${svc.name}» нет метода «${args[1]}».`)
        if (!ctx.invoke) throw new Denied('Вызов службы недоступен: приложение не может звать обработчики плагина.')
        // Доводы чистим ровно так же, как письма: метка функции, доехавшая до
        // чужого плагина, дала бы ему право звать наш код с нашими правами.
        const { data } = packIpc('call', args[2])
        if (!ctx.invokeIn) throw new Denied('Вызов службы недоступен.')
        const ответ = await ctx.invokeIn(svc.pluginId, ref, [data, id])
        // И ответ тоже: он идёт обратно в чужой плагин.
        return packIpc('reply', ответ).data
      }

      // ---- Своё хранилище таблицами (нужно storage) -----------------------
      //
      // Разрешение то же, что у ponoi.storage: это те же данные плагина на этом
      // же устройстве, просто их стало можно хранить по-человечески. Заводить
      // ради этого второе разрешение значило бы спрашивать человека дважды об
      // одном и том же.
      //
      // Имя плагина подставляется ЗДЕСЬ и входит в ключ: чужую таблицу нельзя
      // ни прочитать, ни назвать — её имени просто нет в его пространстве.
      case 'db.insert': {
        need('storage')
        return await dbInsert(id, String(args[0] ?? ''), args[1])
      }
      case 'db.get': {
        need('storage')
        return await dbGet(id, String(args[0] ?? ''), String(args[1] ?? ''))
      }
      case 'db.all': {
        need('storage')
        return await dbAll(id, String(args[0] ?? ''), Number(args[1]) || 1000)
      }
      case 'db.where': {
        need('storage')
        const op = args[2]
        if (!isOp(op)) throw new Denied(`Неизвестное условие «${op}». Есть: ${OPS.join(', ')}.`)
        return await dbWhere(id, String(args[0] ?? ''), String(args[1] ?? ''), op, args[3], Number(args[4]) || 1000)
      }
      case 'db.update': {
        need('storage')
        return await dbUpdate(id, String(args[0] ?? ''), String(args[1] ?? ''), args[2])
      }
      case 'db.remove': {
        need('storage')
        return await dbRemove(id, String(args[0] ?? ''), String(args[1] ?? ''))
      }
      case 'db.count': {
        need('storage')
        return await dbCount(id, String(args[0] ?? ''))
      }
      case 'db.clear': {
        need('storage')
        return await dbClear(id, String(args[0] ?? ''))
      }
      case 'db.tables': {
        need('storage')
        return await dbTables(id)
      }

      // ═══ v1.473.0: свои файлы ═══════════════════════════════════════════
      //
      // Разрешение то же, что у хранилища и таблиц: это данные плагина на
      // устройстве человека, и отдельного согласия «можно хранить ещё и
      // файлы» просить не за что. А вот скачивание — это уже сеть, и там
      // нужны оба разрешения и объявленный домен.
      //
      // Наружу не уходит ни одной ссылки: плагин знает только имя. См.
      // assets.ts, правило 2.
      case 'assets.put': {
        need('storage')
        return await assetPut(id, String(args[0] ?? ''), args[1])
      }
      case 'assets.fetch': {
        need('storage')
        need('net')
        return await assetFetch(plugin, String(args[0] ?? ''), String(args[1] ?? ''))
      }
      case 'assets.get': {
        need('storage')
        return await assetGet(id, String(args[0] ?? ''))
      }
      case 'assets.info': {
        need('storage')
        return await assetInfo(id, String(args[0] ?? ''))
      }
      case 'assets.list': {
        need('storage')
        return await assetList(id)
      }
      case 'assets.remove': {
        need('storage')
        return await assetRemove(id, String(args[0] ?? ''))
      }
      case 'assets.clear': {
        need('storage')
        return await assetClear(id)
      }
      // Играть свой звук. Разрешение notify — то же, что у ponoi.sound.play:
      // звук слышит человек, и это единственное, чем он отличается от чтения
      // файла. Картинку и шрифт здесь играть нечем — отказываем прямо.
      case 'assets.play': {
        need('storage')
        need('notify')
        return await playAsset(id, String(args[0] ?? ''), Number(args[1]))
      }

      // ---- Своё окно-вопрос (нужно ui) ------------------------------------
      // Отличие от ui.confirm/ui.prompt: там один вопрос и один ответ, здесь
      // целая форма. Рисует её приложение теми же строками, что и панель, —
      // чужой разметки в модальном окне не появляется.
      // ---- Перехват вложения (нужно messages.upload) ----------------------
      // Самое сильное после перехвата сообщений: плагин видит КАЖДЫЙ файл,
      // который человек отправляет, и может подменить его содержимое. Ради
      // этого разрешение отдельное и помечено опасным.
      //
      // Зачем это нужно по-настоящему: убрать из фотографии геометку и модель
      // телефона, сжать картинку перед отправкой, наложить водяной знак.
      case 'messages.onUpload': {
        need('messages.upload')
        addInterceptor({ pluginId: id, kind: 'upload', fn: fnRef(args[0], 'messages.onUpload') })
        return null
      }

      case 'ui.dialog': {
        need('ui')
        const o = (args[0] ?? {}) as any
        const rows = dialogRows(
          (Array.isArray(o.rows) ? o.rows : []).map(settingsRow).filter(Boolean) as SettingsRow[],
        )
        return await askDialog({
          pluginId: id,
          pluginName: plugin.manifest.name,
          title: str(o.title ?? 'Вопрос', 60, 'title'),
          text: String(o.text ?? '').slice(0, 500),
          okText: str(o.ok ?? 'Готово', 20, 'ok'),
          cancelText: str(o.cancel ?? 'Отмена', 20, 'cancel'),
          rows,
        })
      }

      // ---- Геймпад (нужно input) -----------------------------------------
      // Только чтение и только то устройство, которое человек воткнул сам.
      // Опрос идёт в приложении: у воркера getGamepads нет и быть не может.
      // ---- Просмотрено ли моё сообщение (нужно messages.read) -------------
      // Отметка приходит от приложения: у плагина нет и не будет доступа к
      // базе. Отдаём только то, что и так видно человеку в открытом у него
      // разговоре, — докуда дочитал собеседник.
      case 'messages.readState': {
        need('messages.read')
        return ctx.readState ? await ctx.readState() : null
      }

      // ---- Любой канал (нужно messages.any) --------------------------------
      // Работает от имени человека и с его правами: куда нельзя ему, туда
      // сервер не пустит и плагин. Личной переписки здесь нет намеренно —
      // она шифруется на устройствах, и писать туда отсюда значило бы слать
      // открытый текст (см. anyChat.ts).
      case 'messages.anyList': {
        need('messages.any')
        return await anyChannels()
      }
      case 'messages.anyRecent': {
        need('messages.any')
        return await anyRecent(args[0], Number(args[1]) || 50)
      }
      case 'messages.anySend': {
        need('messages.any')
        return await anySend(args[0], String(args[1] ?? ''))
      }

      case 'input.gamepads': {
        need('input')
        return readPads()
      }

      default:
        throw new Denied(`Неизвестный метод ponoi.${method}`)
    }
  }
}

// ---- Сеть плагина --------------------------------------------------------------
// Плагин не имеет ни токена сессии, ни куки, поэтому «утечь» через сеть может только
// то, что ему сам отдал API (например, текст сообщений при разрешении messages.read).
// Именно поэтому домены объявляются в @hosts и показываются человеку при установке —
// проверка ниже следит, чтобы этот список было невозможно обойти после установки.
/** Куда можно ходить этому плагину — из одного места с потоком (netGuard.ts). */
function netTarget(plugin: InstalledPlugin): NetTarget {
  const supaHost = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname } catch { return '' } })()
  return { hosts: plugin.manifest.hosts, selfHost: location.hostname, supaHost }
}

/** Общая для запроса и потока подготовка: проверки и разбор доводов.
 *  v1.445.0: раньше всё это лежало внутри pluginFetch, и второй способ выйти в
 *  сеть неизбежно завёл бы вторую копию проверок — а вторая копия рано или
 *  поздно расходится с первой. */
function prepareNet(plugin: InstalledPlugin, rawUrl: string, init: any) {
  const bad = checkTarget(rawUrl, netTarget(plugin))
  if (bad) throw new Denied(bad)
  const method = normMethod(init?.method)
  const badMethod = checkMethod(method)
  if (badMethod) throw new Denied(badMethod)
  return { method, headers: pickHeaders(init?.headers) }
}

async function pluginFetch(plugin: InstalledPlugin, rawUrl: string, init: any): Promise<unknown> {
  const { method, headers } = prepareNet(plugin, rawUrl, init)
  const url = new URL(rawUrl)

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), NET_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'DELETE' ? undefined : String(init?.body ?? ''),
      signal: ctl.signal,
      // Без куки и без авторизации — запрос от имени никого.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, body: text }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Denied(`Сайт не ответил за ${NET_TIMEOUT_MS / 1000} с.`)
    throw new Denied('Запрос не удался: ' + (err?.message ?? String(err)))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * v1.473.0: скачать файл один раз и положить к себе.
 *
 * Зачем отдельно от net.fetch. Тот отдаёт ТЕКСТ: картинка, звук или шрифт,
 * прочитанные как текст, портятся необратимо — вернуть из этого байты уже
 * нельзя. Пропускать двоичное через обычный запрос значит заставлять каждого
 * писать base64 руками и молча ломаться на первом же неверном байте.
 *
 * Правила выхода наружу ровно те же и берутся оттуда же (netGuard.ts): только
 * https, только домены из @hosts, никогда к самому Ponoi, без куки.
 */
async function assetFetch(plugin: InstalledPlugin, name: string, rawUrl: string): Promise<unknown> {
  const { method, headers } = prepareNet(plugin, rawUrl, { method: 'GET' })
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), NET_TIMEOUT_MS)
  try {
    const res = await fetch(new URL(rawUrl).toString(), {
      method, headers, signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    })
    if (!res.ok) throw new Denied(`Сайт ответил ${res.status} — файл не скачан.`)
    const buf = await res.arrayBuffer()
    // Предел проверяется и здесь, и в assetPut. Здесь — чтобы сказать про
    // СКАЧАННОЕ, а не про «файл»: причина у человека разная.
    return await assetPut(plugin.manifest.id, name, buf)
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Denied(`Сайт не ответил за ${NET_TIMEOUT_MS / 1000} с.`)
    if (err instanceof Denied) throw err
    throw new Denied('Не удалось скачать файл: ' + (err?.message ?? String(err)))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Сыграть свой звук (v1.473.0).
 *
 * Адрес файла собирается ЗДЕСЬ и здесь же остаётся: плагину уходит только «да».
 * Громкость своя, но в пределах общей громкости приложения — иначе плагин мог
 * бы играть громче, чем человек разрешил всему остальному.
 */
async function playAsset(pluginId: string, name: string, volume: number): Promise<boolean> {
  const info = await assetInfo(pluginId, name)
  if (!info) throw new Denied(`Файла «${name}» у плагина нет.`)
  if (info.kind !== 'audio' && info.kind !== 'video') {
    throw new Denied(`Файл «${name}» это ${info.type} — играть тут нечего.`)
  }
  const url = await assetUrl(pluginId, name)
  if (!url) throw new Denied(`Файла «${name}» у плагина нет.`)
  const { getSettings } = await import('../settings')
  const своя = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
  const audio = new Audio(url)
  audio.volume = ((getSettings().spkVol ?? 100) / 100) * своя
  await audio.play().catch(() => { throw new Denied('Браузер не дал сыграть звук.') })
  return true
}

/**
 * v1.445.0: ответ по кускам — то, без чего своя ИИ-модель в плагине невозможна.
 *
 * Что было. Единственный способ выйти в сеть ждал ВЕСЬ ответ целиком и не
 * дольше десяти секунд. Модель отвечает по слову и делает это десятками секунд:
 * человек всё это время видел пустоту, а на десятой секунде запрос обрывался. То
 * есть дело было не в «строгих ограничениях вообще», а ровно в двух числах и в
 * отсутствии потока.
 *
 * Что изменилось и чего НЕ изменилось. Ждём дольше (три минуты на весь ответ,
 * сорок пять секунд на очередной кусок — замерший поток обязан умирать) и
 * пропускаем больше (четыре мегабайта). Правила выхода наружу при этом ровно те
 * же и берутся из того же места (netGuard.ts): только https, только домены из
 * @hosts, никогда к самому Ponoi и его серверу, белый список заголовков, без
 * куки. Поток не может пойти туда, куда не может обычный запрос.
 *
 * Куски отдаются обработчику плагина как есть, без разбора: SSE, JSON-строки
 * или сплошной текст — дело плагина. Приложение в содержимое не лезет.
 */
/** Отдать кусок обработчику плагина. Без invoke поток работать не может —
 *  говорим это прямо, а не глотаем куски молча. */
async function callChunk(ctx: HostContext, ref: FnRef, piece: string): Promise<void> {
  if (!ctx.invoke) throw new Denied('Поток недоступен: приложение не может позвать обработчик плагина.')
  await ctx.invoke(ref, [piece])
}

async function pluginStream(
  plugin: InstalledPlugin, rawUrl: string, init: any, onChunk: FnRef, ctx: HostContext,
): Promise<unknown> {
  const { method, headers } = prepareNet(plugin, rawUrl, init)
  const url = new URL(rawUrl)

  const ctl = new AbortController()
  let done = false
  // Общий предел на весь ответ.
  const whole = setTimeout(() => { if (!done) ctl.abort() }, NET_STREAM_MS)
  // И отдельный на молчание: поток, из которого перестали приходить куски,
  // висел бы до общего предела, а это три минуты пустого ожидания.
  let idle = setTimeout(() => { if (!done) ctl.abort() }, NET_STREAM_IDLE_MS)
  const beat = () => {
    clearTimeout(idle)
    idle = setTimeout(() => { if (!done) ctl.abort() }, NET_STREAM_IDLE_MS)
  }

  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'GET' || method === 'DELETE' ? undefined : String(init?.body ?? ''),
      signal: ctl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const body = res.body
    if (!body) {
      // Поток не дали — отдаём то, что есть, одним куском: лучше так, чем
      // молча вернуть пустоту.
      const text = await res.text()
      if (text) await callChunk(ctx, onChunk, text)
      return { ok: res.ok, status: res.status, bytes: text.length }
    }

    const reader = body.getReader()
    const dec = new TextDecoder()
    let total = 0
    for (;;) {
      const { value, done: end } = await reader.read()
      if (end) break
      beat()
      const piece = dec.decode(value, { stream: true })
      if (!piece) continue
      total += piece.length
      // Обработчик упал — прекращаем поток. Продолжать сыпать куски в сломанный
      // обработчик бессмысленно, а тишина скрыла бы поломку от автора плагина.
      try { await callChunk(ctx, onChunk, piece) }
      catch (e: any) {
        try { await reader.cancel() } catch { /* уже закрыт */ }
        throw new Denied('Обработчик потока упал: ' + (e?.message ?? String(e)))
      }
    }
    return { ok: res.ok, status: res.status, bytes: total }
  } catch (err: any) {
    if (err instanceof Denied) throw err
    if (err?.name === 'AbortError') throw new Denied(`Поток замолчал или шёл дольше ${NET_STREAM_MS / 1000} с.`)
    throw new Denied('Поток не удался: ' + (err?.message ?? String(err)))
  } finally {
    done = true
    clearTimeout(whole)
    clearTimeout(idle)
  }
}
