import type { InstalledPlugin, Permission } from './types'
import { isFnRef, type FnRef } from './sandbox'
import {
  addCommand, addComposerButton, addMessageAction, commandOwner, safeIcon,
  setPluginCss, setSettingsPage, type SettingsRow,
} from './registry'
import { readStorage, writeStorage, deleteStorage, listStorage } from './store'
import { VOICE_EFFECTS, activeEffect, isVoiceEffect, setVoiceEffect, rememberVoiceEffect, savedVoiceEffect } from '../voiceFx'

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
    default: return null
  }
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
      case 'log':
        // Всегда можно: это отладочный вывод плагина, наружу он не уходит.
        console.info(`[плагин ${id}]`, String(args[0] ?? '').slice(0, 2000))
        return null

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
        // false — звонка сейчас нет; это не ошибка плагина, поэтому возвращаем
        // ответ, а не исключение: пусть сам решит, ругаться или промолчать.
        return setVoiceEffect(raw)
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
        // Событие о сообщениях — это чтение переписки, отдельное разрешение.
        if (ev === 'message') need('messages.read')
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

  const method = String(init?.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST'].includes(method)) throw new Denied('Разрешены только GET и POST.')

  // Заголовки — узкий белый список: всё остальное плагину не нужно, а лишнее сюда
  // попадать не должно (в том числе Authorization и Cookie).
  const headers: Record<string, string> = {}
  const allowed = ['content-type', 'accept']
  for (const [k, v] of Object.entries(init?.headers ?? {})) {
    if (allowed.includes(k.toLowerCase())) headers[k] = String(v).slice(0, 200)
  }

  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), NET_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: method === 'POST' ? String(init?.body ?? '').slice(0, NET_MAX_BYTES) : undefined,
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
