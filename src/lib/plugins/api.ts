import { PLUGIN_EVENTS, PLUGIN_EVENT_NAMES, type InstalledPlugin, type Permission } from './types'
import { isFnRef, type FnRef } from './sandbox'
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
export interface HostContext {
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
const NET_TIMEOUT_MS = 10_000
const NET_MAX_BYTES = 1024 * 1024
const MAX_STORAGE_VALUE = 64 * 1024
const MAX_CSS = 128 * 1024
const MAX_LABEL = 40

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
function rateLimit(key: string, times: number, windowMs: number, what: string) {
  const now = Date.now()
  const arr = (RATE[key] ??= []).filter(t => now - t < windowMs)
  if (arr.length >= times) {
    RATE[key] = arr
    throw new Denied(`Слишком часто: ${what} можно не больше ${times} раз за ${Math.round(windowMs / 1000)} с.`)
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
        if (css.length > MAX_CSS) throw new Denied('Слишком много CSS (больше 128 КБ).')
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
        rateLimit(id + ':music', 20, 10_000, 'управлять плеером')
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
        // Добавление ссылки — запись в общий склад, поэтому отдельно и редко:
        // плагин с ошибкой в цикле иначе завалил бы Трекотеку у всех.
        rateLimit(id + ':music.add', 5, 60_000, 'добавлять треки')
        const b = musicBridge()
        if (!b) throw new Denied('Плеер сейчас не открыт — добавлять некуда.')
        const why = await b.add(str(args[0], 500, 'ссылка на трек'))
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
        rateLimit(id + ':react', 10, 10_000, 'ставить реакции')
        const b = chatBridge(ctx.channel?.()?.id)
        if (!b) throw new Denied('Сейчас не открыт ни один чат.')
        const why = await b.react(str(args[0], 60, 'id сообщения'), str(args[1], 16, 'эмодзи'))
        if (why) throw new Denied(why)
        return true
      }
      case 'messages.remove': {
        need('messages.write')
        rateLimit(id + ':remove', 5, 10_000, 'удалять сообщения')
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
        rateLimit(id + ':open', 5, 10_000, 'открывать каналы')
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
        rateLimit(id + ':status', 5, 60_000, 'менять активность')
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
        rateLimit(id + ':sound', 5, 10_000, 'играть звук')
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
        rateLimit(id + ':send', 5, 10_000, 'отправлять сообщения')
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
        rateLimit(id + ':notify', 10, 10_000, 'показывать уведомления')
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
        if (json.length > MAX_STORAGE_VALUE) throw new Denied('Значение больше 64 КБ.')
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
        rateLimit(id + ':net', 20, 10_000, 'обращаться в интернет')
        return await pluginFetch(plugin, String(args[0] ?? ''), args[1] as any)
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
        rateLimit(id + ':ask', 5, 10_000, 'спрашивать')
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
        rateLimit(id + ':ask', 5, 10_000, 'спрашивать')
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
        rateLimit(id + ':clip', 10, 10_000, 'копировать в буфер')
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
async function pluginFetch(plugin: InstalledPlugin, rawUrl: string, init: any): Promise<unknown> {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Denied('Плохой адрес запроса.') }

  if (url.protocol !== 'https:') throw new Denied('Разрешены только https-адреса.')
  if (!plugin.manifest.hosts.includes(url.hostname.toLowerCase())) {
    throw new Denied(`Домен ${url.hostname} не объявлен в @hosts этого плагина.`)
  }
  // Своё же приложение и свой бэкенд — не «внешний сайт»: запрос туда пошёл бы с
  // куками/через наш же origin, чего плагину не положено вообще никогда.
  const supaHost = (() => { try { return new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname } catch { return '' } })()
  if (url.hostname === location.hostname || (supaHost && url.hostname === supaHost)) {
    throw new Denied('Обращаться к самому Ponoi и его серверу плагинам нельзя.')
  }

  // v1.419.0: полный набор методов. Раньше были только GET и POST — то есть
  // половина обычных API (всё, что правит и удаляет) плагину была недоступна,
  // хотя ходить он всё равно может только на объявленные в @hosts домены.
  const method = String(init?.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Denied('Разрешены методы GET, POST, PUT, PATCH и DELETE.')
  }

  // Заголовки — белый список. v1.419.0: в нём появились те, которыми
  // подписываются у чужих API (Authorization, X-Api-Key и подобные): без них
  // плагин не мог обратиться ни к одному сервису, где нужен ключ, — а это почти
  // все. Опасности в этом нет: ключ плагин приносит свой, запрос идёт без куки
  // (credentials: omit) и только на домен из @hosts, а до самого Ponoi и его
  // сервера дорога закрыта отдельной проверкой выше.
  //
  // Cookie по-прежнему нельзя: это единственный заголовок, который браузер
  // считает «своим» для сайта, и подставлять его плагину незачем.
  const headers: Record<string, string> = {}
  const allowed = ['content-type', 'accept', 'authorization', 'x-api-key', 'x-auth-token', 'user-agent', 'accept-language']
  for (const [k, v] of Object.entries(init?.headers ?? {})) {
    if (allowed.includes(k.toLowerCase())) headers[k] = String(v).slice(0, 500)
  }

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
