import { PLUGIN_EVENTS, PLUGIN_EVENT_NAMES, type InstalledPlugin, type Permission } from './types'
import { isFnRef, type FnRef } from './sandbox'
import { checkTarget, checkMethod, pickHeaders, normMethod, type NetTarget } from './netGuard'
import {
  LIMITS, MAX_STORAGE_VALUE, MAX_CSS, MAX_LABEL,
  NET_TIMEOUT_MS, NET_MAX_BYTES, NET_STREAM_MS, NET_STREAM_IDLE_MS, NET_STREAM_MAX_BYTES,
} from './limits'
import {
  addCommand, addComposerButton, addMessageAction, addHotkey, okCombo, commandOwner, safeIcon,
  setPluginCss, setSettingsPage, setPanel, PANEL_SLOTS, type SettingsRow, type PanelSlot,
} from './registry'
import { musicBridge } from './musicApi'
import { chatBridge, MAX_RECENT } from './chatApi'
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
  'label', 'text', 'button', 'toggle', 'select', 'slider', 'color', 'image', 'progress', 'css',
] as const

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
  /** Спросить у человека «да/нет». Возвращает его ответ. */
  confirm?: (title: string, text: string, ok: string) => Promise<boolean>
  /** Спросить строку. null — человек отказался. */
  prompt?: (title: string, placeholder: string, value: string) => Promise<string | null>
}

/** Сколько ждём ответа от чужого сайта и сколько байт согласны принять. */
// v1.445.0: обычному запросу десяти секунд хватало, а вот ИИ-модели отвечают
// дольше — двадцать-шестьдесят секунд для генерации это норма. Пока предел был
// общий и равнялся десяти, встроить в плагин свою модель было нельзя в
// принципе: запрос обрывался раньше, чем приходил ответ.
// v1.446.0: все числа — в src/lib/plugins/limits.ts, одной таблицей.

class Denied extends Error {}

/**
 * Ограничение частоты (v1.345.0).
 *
 * Отправка сообщений и уведомления раньше не были ничем ограничены: плагин мог
 * за секунду выплюнуть в канал сотню сообщений от имени человека — и забанят
 * за это человека, а не плагин. Считаем по скользящему окну, отдельно для
 * каждого плагина и каждого действия.
 */
const RATE: Record<string, number[]> = {}
/**
 * v1.446.0: числа больше не пишутся по месту — они лежат в одной таблице
 * (limits.ts). Раньше четырнадцать пределов были разбросаны по файлу, и поднять
 * их «все» означало найти все четырнадцать и ни одного не пропустить.
 *
 * Сами пределы подняты в десятки раз: это защита от зациклившегося плагина, а
 * не от плагина вообще. Совсем убрать их нельзя — цикл без конца подвесил бы
 * приложение, и человек не добрался бы до кнопки «выключить».
 */
function rateLimit(pluginId: string, kind: string) {
  const l = LIMITS[kind]
  if (!l) return   // неизвестный вид — не выдумываем предел из головы
  const key = pluginId + ':' + kind
  const now = Date.now()
  const arr = (RATE[key] ??= []).filter(t => now - t < l.windowMs)
  if (arr.length >= l.times) {
    RATE[key] = arr
    throw new Denied(`Слишком часто: ${l.what} можно не больше ${l.times} раз за ${Math.round(l.windowMs / 1000)} с.`)
  }
  arr.push(now)
  RATE[key] = arr
}

function str(v: unknown, max: number, what: string): string {
  const s = String(v ?? '').trim()
  if (!s) throw new Denied(`${what}: пустое значение`)
  return s.length > max ? s.slice(0, max) : s
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
        if (css.length > MAX_CSS) throw new Denied(`Слишком много CSS (больше ${Math.round(MAX_CSS / 1024)} КБ).`)
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
          tooltip: str(o?.tooltip, MAX_LABEL, 'подсказка кнопки'),
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
          label: str(o?.label, MAX_LABEL, 'подпись действия'),
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
      case 'ui.addPanel': {
        need('panel')
        const o = args[0] as any
        const slot = String(o?.slot ?? '') as PanelSlot
        if (!(slot in PANEL_SLOTS)) {
          throw new Denied(`Неизвестное место «${slot}». Есть: ${Object.keys(PANEL_SLOTS).join(', ')}.`)
        }
        const rows = (Array.isArray(o?.rows) ? o.rows : []).slice(0, 20).map(settingsRow).filter(Boolean) as SettingsRow[]
        setPanel({ pluginId: id, slot, title: str(o?.title ?? plugin.manifest.name, 40, 'заголовок панели'), rows })
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
        rateLimit(id, 'music')
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
        rateLimit(id, 'music.add')
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
        const n = Math.min(Math.max(Math.round(Number(args[0]) || 20), 1), MAX_RECENT)
        return b.recent(n)
      }
      case 'messages.react': {
        need('messages.write')
        rateLimit(id, 'react')
        const b = chatBridge(ctx.channel?.()?.id)
        if (!b) throw new Denied('Сейчас не открыт ни один чат.')
        const why = await b.react(str(args[0], 60, 'id сообщения'), str(args[1], 16, 'эмодзи'))
        if (why) throw new Denied(why)
        return true
      }
      case 'messages.remove': {
        need('messages.write')
        rateLimit(id, 'remove')
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
        rateLimit(id, 'open')
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
        rateLimit(id, 'status')
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
        rateLimit(id, 'sound')
        const name = String(args[0] ?? 'chime')
        if (!(PLUGIN_SOUND_NAMES as readonly string[]).includes(name)) {
          throw new Denied(`Нет такого звука «${name}». Есть: ${PLUGIN_SOUND_NAMES.join(', ')}.`)
        }
        await pluginPlaySound(name)
        return true
      }

      case 'commands.register': {
        need('commands')
        const name = str(args[0], 32, 'имя команды').toLowerCase().replace(/^\//, '')
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
        addCommand({ pluginId: id, name, description: str(args[1], 100, 'описание команды'), handler: fnRef(args[2], 'команда') })
        return null
      }

      case 'messages.send': {
        need('messages.write')
        // Человек пишет руками в лучшем случае несколько сообщений за десять
        // секунд — плагину столько же и хватит.
        rateLimit(id, 'send')
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
        rateLimit(id, 'notify')
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
        if (json.length > MAX_STORAGE_VALUE) throw new Denied(`Значение больше ${Math.round(MAX_STORAGE_VALUE / 1024)} КБ.`)
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
        rateLimit(id, 'net')
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
        rateLimit(id, 'netstream')
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
        rateLimit(id, 'ask')
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
        rateLimit(id, 'ask')
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
        rateLimit(id, 'clip')
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
        return null
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
      body: method === 'GET' || method === 'DELETE' ? undefined : String(init?.body ?? '').slice(0, NET_MAX_BYTES),
      signal: ctl.signal,
      // Без куки и без авторизации — запрос от имени никого.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const text = (await res.text()).slice(0, NET_MAX_BYTES)
    return { ok: res.ok, status: res.status, body: text }
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Denied(`Сайт не ответил за ${NET_TIMEOUT_MS / 1000} с.`)
    throw new Denied('Запрос не удался: ' + (err?.message ?? String(err)))
  } finally {
    clearTimeout(timer)
  }
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
      body: method === 'GET' || method === 'DELETE' ? undefined : String(init?.body ?? '').slice(0, NET_MAX_BYTES),
      signal: ctl.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const body = res.body
    if (!body) {
      // Поток не дали — отдаём то, что есть, одним куском: лучше так, чем
      // молча вернуть пустоту.
      const text = (await res.text()).slice(0, NET_STREAM_MAX_BYTES)
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
      if (total > NET_STREAM_MAX_BYTES) {
        // Дальше не читаем: иначе бесконечный поток съест память вкладки.
        try { await reader.cancel() } catch { /* уже закрыт */ }
        throw new Denied(`Ответ длиннее ${Math.round(NET_STREAM_MAX_BYTES / 1024 / 1024)} МБ — поток прерван.`)
      }
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
