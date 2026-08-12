// v1.333.0: плагины «от нас» — идут в самой сборке, а не в каталоге в базе.
//
// Почему в сборке. Каталог — это то, что выложили люди; он живёт в базе, его
// может не быть (миграция не применена) или он может быть пуст. Плагины от
// создателя должны быть на месте всегда и ставиться без сети — поэтому они
// лежат здесь обычными строками и проходят ровно тот же путь установки, что и
// любой чужой плагин: разбор шапки, экран разрешений, песочница. Никаких
// поблажек «своим»: если официальный плагин просит messages.read, человек это
// увидит и сможет отказаться.

export interface OfficialPlugin {
  id: string
  /** Короткое описание для карточки в каталоге — длинное там не помещается. */
  summary: string
  /** Эмодзи вместо картинки: своя иконка у официальных не нужна, а вес нулевой. */
  emoji: string
  code: string
}

// ── 1. Смена голоса ────────────────────────────────────────────────────────
const VOICE = `/**
 * @name Смена голоса
 * @id ponoi-voice-changer
 * @version 1.0.0
 * @author NeyLivo
 * @description Меняет твой голос в звонке: робот, эхо, рация, хор, подводный. Команда /голос и кнопка в звонке.
 * @permissions voice, commands, notify, settings
 */
export async function onLoad(neylivo) {
  const list = await neylivo.voice.list()
  const names = list.map(e => e.label).join(', ')

  await neylivo.commands.register('голос', 'Сменить свой голос в звонке: ' + names, async (arg) => {
    const want = String(arg || '').trim().toLowerCase()
    if (!want) {
      const cur = await neylivo.voice.current()
      const curLabel = (list.find(e => e.id === cur) || {}).label || cur
      neylivo.notify('Сейчас: ' + curLabel + '. Доступно: ' + names)
      return
    }
    const found = list.find(e => e.label.toLowerCase() === want || e.id === want)
    if (!found) { neylivo.notify('Нет такого голоса. Есть: ' + names); return }
    const ok = await neylivo.voice.setEffect(found.id)
    neylivo.notify(ok ? 'Голос: ' + found.label : 'Ты сейчас не в звонке — голос включится со следующего')
  })

  await neylivo.ui.addSettingsPage({
    title: 'Смена голоса',
    rows: [{
      type: 'select',
      key: 'default',
      label: 'Голос по умолчанию',
      description: 'Включается сам при входе в звонок',
      value: await neylivo.voice.current(),
      options: list.map(e => ({ value: e.id, label: e.label })),
    }],
  })

  neylivo.on('settings', async (e) => {
    if (e.key !== 'default') return
    // setEffect запоминает выбор сам — он же станет голосом следующего звонка.
    const now = await neylivo.voice.setEffect(e.value)
    const label = (list.find(x => x.id === e.value) || {}).label || e.value
    neylivo.notify(now ? 'Голос: ' + label : 'Голос ' + label + ' включится со следующего звонка')
  })
}
`

// ── 2. Кубик и монетка ─────────────────────────────────────────────────────
const DICE = `/**
 * @name Кубик и жребий
 * @id ponoi-dice
 * @version 1.0.0
 * @author NeyLivo
 * @description Кубик, монетка и «выбери за меня» — с подсказками прямо в поле ввода: видно, что писать дальше.
 * @permissions commands, messages.write
 */
export async function onLoad(neylivo) {
  const rnd = (n) => Math.floor(Math.random() * n)

  // v1.477.0: команда объявляет ДОВОДЫ — приложение показывает их в поле ввода
  // и подсказывает значения. Раньше человек, набравший «/кубик», видел пустоту.
  await neylivo.commands.register({
    name: 'кубик',
    description: 'Бросить кубик',
    args: [{
      name: 'граней',
      description: 'сколько граней, по умолчанию 6',
      options: [
        { value: '6', label: 'обычный, 6' },
        { value: '20', label: 'ролевой, 20' },
        { value: '100', label: 'сотка, 100' },
      ],
    }],
    onRun: async (строка) => {
      const sides = Math.min(1000, Math.max(2, parseInt(строка, 10) || 6))
      await neylivo.messages.send('🎲 Кубик на ' + sides + ': выпало ' + (rnd(sides) + 1))
    },
  })

  await neylivo.commands.register('монетка', 'Орёл или решка', async () => {
    await neylivo.messages.send(rnd(2) ? '🪙 Орёл' : '🪙 Решка')
  })

  await neylivo.commands.register({
    name: 'выбери',
    description: 'Выбрать одно из нескольких',
    args: [{ name: 'варианты', required: true, placeholder: 'чай | кофе | сон' }],
    onRun: async (строка) => {
      const parts = String(строка || '').split(/[|,]/).map(s => s.trim()).filter(Boolean)
      if (parts.length < 2) { await neylivo.messages.send('Дай хотя бы два варианта через |'); return }
      await neylivo.messages.send('🤔 Я выбираю: **' + parts[rnd(parts.length)] + '**')
    },
  })
}
`

// ── 3. Таймер ──────────────────────────────────────────────────────────────
const TIMER = `/**
 * @name Напоминания
 * @id ponoi-timer
 * @version 1.0.0
 * @author NeyLivo
 * @description /напомни 10м заварить чай. Напоминания переживают перезапуск приложения — они лежат на этом устройстве, а не в памяти.
 * @permissions commands, notify, storage, background, settings
 */
export async function onLoad(neylivo) {
  // v1.477.0: раньше это был setTimeout — то есть напоминание умирало вместе с
  // закрытым приложением, о чём человек узнавал ровно тогда, когда оно не
  // сработало. Теперь срок лежит в таблице, а проверяет его фоновая задача.
  const таблица = () => neylivo.db.table('напоминания')

  async function проверить() {
    const сейчас = Date.now()
    const все = await таблица().all(200)
    for (const н of все) {
      if (Number(н.когда) > сейчас) continue
      neylivo.notify('⏰ ' + (н.текст || 'Время вышло'))
      await таблица().remove(н.id)
    }
  }

  async function показать() {
    const все = (await таблица().all(200)).sort((a, b) => a.когда - b.когда)
    await neylivo.ui.addSettingsPage({
      title: 'Напоминания',
      rows: все.length === 0
        ? [{ type: 'label', key: 'нет', label: 'Пока пусто', value: 'Ставится командой /напомни' }]
        : все.slice(0, 20).map(н => ({
            type: 'label', key: 'н' + н.id,
            label: new Date(н.когда).toLocaleString(),
            value: String(н.текст || ''),
          })),
    })
  }

  await neylivo.background.every(20000, проверить, 'напоминания')
  await проверить()
  await показать()

  await neylivo.commands.register({
    name: 'напомни',
    description: 'Напомнить через время',
    args: [
      { name: 'через', required: true, description: '10м, 30с, 2ч',
        options: [{ value: '5м', label: 'через 5 минут' }, { value: '30м', label: 'через полчаса' }, { value: '1ч', label: 'через час' }] },
      { name: 'о чём', placeholder: 'заварить чай' },
    ],
    onRun: async (строка) => {
      const m = String(строка || '').trim().match(/^(\\d+)\\s*([сcмmчh]?)\\s*([\\s\\S]*)$/i)
      if (!m) { neylivo.notify('Формат: /напомни 10м текст'); return }
      const n = parseInt(m[1], 10)
      const unit = (m[2] || 'м').toLowerCase()
      const mult = (unit === 'с' || unit === 'c') ? 1000 : (unit === 'ч' || unit === 'h') ? 3600000 : 60000
      const ms = n * mult
      if (!n || ms > 7 * 24 * 3600000) { neylivo.notify('От 1 секунды до недели'); return }
      await таблица().insert({ когда: Date.now() + ms, текст: (m[3] || '').trim() || 'Время вышло' })
      await показать()
      neylivo.notify('Напомню через ' + n + unit)
    },
  })
}
`

// ── 4. Автоответ «меня нет» ────────────────────────────────────────────────
const AFK = `/**
 * @name Меня нет
 * @id ponoi-afk
 * @version 1.0.0
 * @author NeyLivo
 * @description Ставит твою активность «Отошёл» и отвечает один раз каждому, кто тебя упомянул. Включается кнопкой в шапке.
 * @permissions messages.read, messages.write, status, ui, notify, storage
 */
export async function onLoad(neylivo) {
  // v1.477.0: раньше это была страница настроек с переключателем — то есть
  // включать «меня нет» надо было, уже уходя, через три экрана. Теперь кнопка
  // в шапке и один вопрос, а заодно приложение показывает другим «Отошёл»:
  // половина смысла была именно в этом, и её не было.
  let включён = false
  const отвечено = new Set()
  const текст = async () => (await neylivo.storage.get('текст')) || 'Отошёл — отвечу, как вернусь.'

  async function переключить() {
    if (включён) {
      включён = false
      отвечено.clear()
      await neylivo.status.set('')
      neylivo.notify('С возвращением')
      return
    }
    const ответ = await neylivo.ui.dialog({
      title: 'Отойти',
      text: 'Отвечу за тебя один раз каждому, кто упомянет.',
      ok: 'Отойти',
      rows: [
        { type: 'text', key: 'текст', label: 'Что отвечать', value: await текст() },
        { type: 'text', key: 'активность', label: 'Активность', value: 'Отошёл' },
      ],
    })
    if (!ответ) return
    await neylivo.storage.set('текст', String(ответ.текст || ''))
    await neylivo.status.set(String(ответ.активность || 'Отошёл'))
    включён = true
    neylivo.notify('Отвечаю за тебя')
  }

  await neylivo.ui.addHeaderButton({ key: 'afk', icon: 'clock', tooltip: 'Меня нет', onClick: переключить })

  neylivo.on('message', async (msg) => {
    if (!включён || !msg.mentionsMe || отвечено.has(msg.author)) return
    отвечено.add(msg.author)
    await neylivo.messages.send(await текст())
  })
}
`

// ── 5. Ночная тема помягче ─────────────────────────────────────────────────
const SOFT = `/**
 * @name Мягкий свет
 * @id ponoi-soft-light
 * @version 1.0.0
 * @author NeyLivo
 * @description Приглушает цвета приложения — глазам вечером легче. Без своих стилей: меняются только цвета, вёрстка не трогается.
 * @permissions ui.theme, settings, storage
 */
export async function onLoad(neylivo) {
  // v1.477.0: раньше плагин ставил свой CSS — то есть лез в чужую вёрстку и
  // ломался бы от любой правки разметки. Теперь он меняет ЦВЕТА через
  // безопасный набор имён: сломать этим ничего нельзя.
  const НАБОРЫ = {
    low:  { 'bg-content': '#31333a', 'bg-main': '#2a2c33', 'text': '#cfd2d6', 'text-muted': '#8d939c' },
    mid:  { 'bg-content': '#2b2d33', 'bg-main': '#25272d', 'text': '#c2c6cb', 'text-muted': '#848a93' },
    high: { 'bg-content': '#232529', 'bg-main': '#1e2024', 'text': '#b3b8be', 'text-muted': '#79808a' },
  }

  const сила = async () => String((await neylivo.storage.get('сила')) || 'mid')

  async function применить() {
    const s = await сила()
    if (s === 'off') { await neylivo.ui.clearTheme(); return }
    await neylivo.ui.setTheme(НАБОРЫ[s] || НАБОРЫ.mid)
  }

  await neylivo.ui.addSettingsPage({
    title: 'Мягкий свет',
    rows: [{
      type: 'select', key: 'сила', label: 'Сила', description: 'Насколько приглушать',
      value: await сила(),
      options: [
        { value: 'off', label: 'Выключено' },
        { value: 'low', label: 'Слегка' },
        { value: 'mid', label: 'Средне' },
        { value: 'high', label: 'Сильно' },
      ],
    }],
  })

  neylivo.on('settings', async (e) => {
    if (e.key !== 'сила') return
    await neylivo.storage.set('сила', String(e.value))
    await применить()
  })

  await применить()
}
`

// ── 8. Прочитано ───────────────────────────────────────────────────────────
//
// v1.477.0. Показывает то, чего в приложении не было вовсе: прочитал ли
// собеседник твоё сообщение. Данные даёт приложение (см. lib/dmReads.ts и
// миграцию 106) — своей дороги к базе у плагина нет и не будет.
const READS = `/**
 * @name Прочитано
 * @id ponoi-read-receipts
 * @version 1.0.0
 * @author NeyLivo
 * @description Показывает в личной переписке, когда собеседник её прочитал. Работает в обе стороны: не показываешь свою отметку — не видишь чужую.
 * @permissions panel, messages.read, context, notify
 */
export async function onLoad(neylivo) {
  let последнее = null

  async function рисуй() {
    const s = await neylivo.messages.readState()
    let текст
    if (!s) текст = 'Только в личной переписке'
    else if (!s.on) текст = 'Отметки выключены в настройках'
    else текст = s.seenLabel || 'Пока не прочитано'
    последнее = s
    await neylivo.ui.addPanel({
      slot: 'chat',
      title: 'Прочитано',
      rows: [
        { type: 'label', key: 'состояние', label: 'Собеседник', value: текст },
        { type: 'button', key: 'обновить', label: 'Проверить сейчас', onClick: рисуй },
      ],
    })
  }

  await рисуй()
  // Событием, а не опросом: приложение само скажет, когда отметка изменилась.
  neylivo.on('read', async (e) => {
    await рисуй()
    if (!последнее || !последнее.at) neylivo.notify('Твоё сообщение прочитали')
  })
  neylivo.on('channel', рисуй)
}
`

// ── 9. Заметки ─────────────────────────────────────────────────────────────
//
// v1.477.0. Показывает окно-вкладку и таблицы: заметок может быть тысяча, и
// хранилище «ключ-значение» для такого не годится.
const NOTES = `/**
 * @name Заметки
 * @id ponoi-notes
 * @version 1.0.0
 * @author NeyLivo
 * @description Свои заметки прямо в NeyLivo: отдельная вкладка, поиск, сколько угодно записей. Хранятся на этом устройстве.
 * @permissions apps, storage, commands, ui
 */
export async function onLoad(neylivo) {
  let окно = null, поиск = ''

  const все = async () => (await neylivo.db.table('заметки').all(500))
    .sort((a, b) => (b.когда || 0) - (a.когда || 0))

  async function строки() {
    const список = (await все()).filter(z => !поиск || String(z.текст).toLowerCase().includes(поиск))
    const r = [
      { type: 'text', key: 'поиск', label: 'Поиск', placeholder: 'по словам', value: поиск },
      { type: 'button', key: 'новая', label: '+ Новая заметка', onClick: новая },
      { type: 'label', key: 'сколько', label: 'Всего', value: String((await все()).length) },
    ]
    for (const z of список.slice(0, 40)) {
      r.push({ type: 'label', key: 'z' + z.id, label: new Date(z.когда).toLocaleString(), value: String(z.текст).slice(0, 90) })
      r.push({ type: 'button', key: 'u' + z.id, label: 'Убрать', onClick: async () => {
        await neylivo.db.table('заметки').remove(z.id)
        await обновить()
      } })
    }
    return r
  }

  async function новая() {
    const ответ = await neylivo.ui.dialog({
      title: 'Новая заметка', ok: 'Сохранить',
      rows: [{ type: 'text', key: 'текст', label: 'Текст', value: '' }],
    })
    if (!ответ || !String(ответ.текст || '').trim()) return
    await neylivo.db.table('заметки').insert({ текст: String(ответ.текст).trim(), когда: Date.now() })
    await обновить()
  }

  async function обновить() {
    if (окно === null) return
    await neylivo.apps.update(окно, { rows: await строки() })
  }

  async function открыть() {
    if (окно !== null) { await обновить(); return }
    окно = await neylivo.apps.create({ mode: 'tab', title: 'Заметки', icon: 'list', rows: await строки() })
  }

  neylivo.on('settings', async (e) => {
    if (e.key === 'поиск') { поиск = String(e.value || '').toLowerCase(); await обновить() }
  })
  neylivo.on('app', (e) => { if (!e.open) окно = null })

  await neylivo.commands.register('заметки', 'Открыть свои заметки', открыть)
  await neylivo.ui.addComposerButton({ key: 'заметки', icon: 'list', tooltip: 'Заметки', onClick: открыть })
}
`

// ── 10. Секретка ───────────────────────────────────────────────────────────
//
// v1.477.0. Показывает перехват сообщений — самое сильное разрешение из всех.
// Личная переписка в NeyLivo и так шифруется; смысл этого плагина в другом: он
// прячет текст в ОБЩЕМ канале, где шифрования нет, — и прочитать его смогут
// только те, кому ты сказал слово.
const SECRET = `/**
 * @name Секретка
 * @id ponoi-secret
 * @version 1.0.0
 * @author NeyLivo
 * @description Прячет твои сообщения в канале за секретным словом: пишешь !с текст — уходит шифром, а у тех, кто знает слово, читается обычным текстом.
 * @permissions messages.intercept, settings, storage
 */
export async function onLoad(neylivo) {
  const МЕТКА = 'сек1:'

  const слово = async () => String((await neylivo.storage.get('слово')) || '')

  // Простой обратимый шифр на слове. ЧЕСТНО: это не защита от того, кто знает,
  // что делает, — сервер видит длину и время, а слово подбирается перебором.
  // Это ширма от чужих глаз в общем канале, и так и написано на странице.
  function шифр(текст, ключ) {
    const t = new TextEncoder().encode(текст)
    const k = new TextEncoder().encode(ключ)
    const out = new Uint8Array(t.length)
    for (let i = 0; i < t.length; i++) out[i] = t[i] ^ k[i % k.length] ^ (i * 7 & 0xff)
    let s = ''
    for (const b of out) s += String.fromCharCode(b)
    return btoa(s)
  }
  function расшифр(строка, ключ) {
    try {
      const bin = atob(строка)
      const k = new TextEncoder().encode(ключ)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) ^ k[i % k.length] ^ (i * 7 & 0xff)
      const t = new TextDecoder('utf-8', { fatal: true }).decode(out)
      return t
    } catch (e) { return null }
  }

  await neylivo.ui.addSettingsPage({
    title: 'Секретка',
    rows: [
      { type: 'text', key: 'слово', label: 'Секретное слово', description: 'Знают его — прочитают. Одно на всех, кому пишешь.', value: await слово() },
      { type: 'label', key: 'как', label: 'Как писать', value: 'Начни сообщение с !с — например: !с встречаемся в семь' },
      { type: 'label', key: 'честно', label: 'Честно', value: 'Это ширма от чужих глаз, а не настоящая защита: слово подбирается перебором' },
    ],
  })
  neylivo.on('settings', async (e) => { if (e.key === 'слово') await neylivo.storage.set('слово', String(e.value || '')) })

  neylivo.messages.onBeforeSend(async (ctx) => {
    const k = await слово()
    if (!k || ctx.content.slice(0, 3) !== '!с ') return
    return { content: МЕТКА + шифр(ctx.content.slice(3), k) }
  })

  neylivo.messages.onBeforeRender(async (ctx) => {
    if (ctx.content.slice(0, МЕТКА.length) !== МЕТКА) return
    const k = await слово()
    const т = k ? расшифр(ctx.content.slice(МЕТКА.length), k) : null
    return { content: т === null ? '🔒 секретка (не то слово)' : '🔓 ' + т }
  })
}
`

// ── 11. Погода ─────────────────────────────────────────────────────────────
//
// v1.477.0. Показывает сеть: единственный плагин от нас, который вообще куда-то
// ходит. Сервис выбран без ключа и без учётной записи (open-meteo) — иначе
// «поставил и не работает, пока не заведёшь ключ».
const WEATHER = `/**
 * @name Погода
 * @id ponoi-weather
 * @version 1.0.0
 * @author NeyLivo
 * @description Погода в твоём городе — панелью в чате и командой /погода. Без ключей и регистрации.
 * @permissions panel, commands, net, storage, settings, messages.write
 * @hosts api.open-meteo.com, geocoding-api.open-meteo.com
 */
export async function onLoad(neylivo) {
  const ВИД = { 0: 'ясно ☀️', 1: 'почти ясно 🌤', 2: 'облачно 🌥', 3: 'пасмурно ☁️',
    45: 'туман 🌫', 48: 'туман 🌫', 51: 'морось 🌦', 61: 'дождь 🌧', 63: 'дождь 🌧',
    65: 'ливень 🌧', 71: 'снег 🌨', 73: 'снег 🌨', 75: 'снегопад 🌨', 80: 'ливни 🌦',
    95: 'гроза ⛈', 96: 'гроза с градом ⛈' }

  const город = async () => String((await neylivo.storage.get('город')) || 'Москва')

  async function найтиГород(имя) {
    const r = await neylivo.net.fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=' + encodeURIComponent(имя))
    const j = JSON.parse(r.body)
    const m = j && j.results && j.results[0]
    return m ? { lat: m.latitude, lon: m.longitude, имя: m.name } : null
  }

  async function погода() {
    const место = await найтиГород(await город())
    if (!место) return null
    const r = await neylivo.net.fetch('https://api.open-meteo.com/v1/forecast?current_weather=true&latitude=' + место.lat + '&longitude=' + место.lon)
    const j = JSON.parse(r.body)
    const c = j && j.current_weather
    if (!c) return null
    return { имя: место.имя, темп: Math.round(c.temperature), ветер: Math.round(c.windspeed), вид: ВИД[c.weathercode] || 'непонятно' }
  }

  async function рисуй() {
    let строка = 'смотрю…'
    try {
      const п = await погода()
      строка = п ? п.темп + '°, ' + п.вид : 'не нашёл город'
    } catch (e) { строка = 'нет связи' }
    await neylivo.ui.addPanel({
      slot: 'chat', title: 'Погода',
      rows: [
        { type: 'label', key: 'сейчас', label: await город(), value: строка },
        { type: 'button', key: 'обновить', label: 'Обновить', onClick: рисуй },
      ],
    })
  }

  await neylivo.ui.addSettingsPage({
    title: 'Погода',
    rows: [{ type: 'text', key: 'город', label: 'Город', placeholder: 'Москва', value: await город() }],
  })
  neylivo.on('settings', async (e) => {
    if (e.key !== 'город') return
    await neylivo.storage.set('город', String(e.value || ''))
    await рисуй()
  })

  await neylivo.commands.register({
    name: 'погода',
    description: 'Погода в городе',
    args: [{ name: 'город', description: 'по умолчанию — из настроек' }],
    onRun: async (строка) => {
      const имя = строка.trim()
      if (имя) await neylivo.storage.set('город', имя)
      const п = await погода()
      await neylivo.messages.send(п ? ('Погода, ' + п.имя + ': ' + п.темп + '°, ' + п.вид + ', ветер ' + п.ветер + ' км/ч') : 'Не нашёл такой город')
    },
  })

  await рисуй()
}
`

// ── 12. Волны музыки ───────────────────────────────────────────────────────
//
// v1.477.0. Показывает холст: единственное место, где плагин рисует сам. Своего
// звука ему не дают (и не дадут — см. types.ts), поэтому картинка идёт от того,
// что приложение сообщает о треке: смена, пауза, продолжение.
const VIZ = `/**
 * @name Волны музыки
 * @id ponoi-music-waves
 * @version 1.0.0
 * @author NeyLivo
 * @description Живая картинка в плеере: волны идут, пока играет музыка, и замирают на паузе.
 * @permissions panel, music
 */
export async function onLoad(neylivo) {
  let ctx = null, играет = false, фаза = 0, кадр = null, видно = false

  await neylivo.ui.addPanel({
    slot: 'player', title: 'Волны',
    rows: [{ type: 'canvas', key: 'волны', label: 'Волны', height: 90 }],
  })
  const холст = await neylivo.ui.getCanvas('волны')
  ctx = холст.getContext('2d')

  function рисуй() {
    кадр = null
    if (!ctx) return
    const ш = холст.width, в = холст.height
    ctx.clearRect(0, 0, ш, в)
    ctx.lineWidth = 2
    for (let сл = 0; сл < 3; сл++) {
      ctx.beginPath()
      ctx.strokeStyle = сл === 0 ? '#5865f2' : сл === 1 ? '#7aa2ff' : '#3a4bd8'
      for (let x = 0; x <= ш; x += 4) {
        const a = (в / 2 - 6) * (0.4 + 0.3 * сл)
        const y = в / 2 + Math.sin((x / ш) * Math.PI * (2 + сл) + фаза * (1 + сл * 0.3)) * a
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    if (играет) фаза += 0.08
    // Пока панель не видно — не рисуем вовсе: это батарея на телефоне.
    if (видно && играет) кадр = setTimeout(рисуй, 40)
  }

  function пуск() { if (кадр === null) рисуй() }

  neylivo.on('canvas', (e) => { видно = !!e.visible; if (видно) пуск() })
  neylivo.on('music', (e) => { играет = !!e.playing; пуск() })
  const сейчас = await neylivo.music.now()
  играет = !!(сейчас && сейчас.playing)
  рисуй()
}
`

// ── 7. Чистка фотографий ───────────────────────────────────────────────────
//
// v1.475.0: первый плагин на перехвате вложений — и настоящая польза, а не
// показ возможности. В обычной фотографии с телефона лежат координаты места
// съёмки, модель телефона и точное время. Человек отправляет её в чат и
// раздаёт это всё вместе с картинкой, не зная.
const EXIF = `/**
 * @name Чистка фотографий
 * @id ponoi-photo-clean
 * @version 1.0.0
 * @author NeyLivo
 * @description Убирает из фотографий геометку, модель телефона и время съёмки перед отправкой. Может заодно сжимать большие снимки.
 * @permissions messages.upload, settings, storage
 */
export async function onLoad(neylivo) {
  const наст = async () => ({
    чистить: (await neylivo.storage.get('чистить')) !== false,
    сжимать: (await neylivo.storage.get('сжимать')) === true,
    сторона: Number(await neylivo.storage.get('сторона')) || 2048,
  })

  await neylivo.ui.addSettingsPage({
    title: 'Чистка фотографий',
    rows: [
      { type: 'toggle', key: 'чистить', label: 'Убирать метаданные',
        description: 'Геометка, модель телефона, время съёмки', value: (await наст()).чистить },
      { type: 'toggle', key: 'сжимать', label: 'Уменьшать большие снимки',
        description: 'Длинная сторона не больше выбранной', value: (await наст()).сжимать },
      { type: 'slider', key: 'сторона', label: 'Длинная сторона, пикселей',
        value: (await наст()).сторона, min: 720, max: 4096, step: 64 },
    ],
  })
  neylivo.on('settings', async (e) => { await neylivo.storage.set(e.key, e.value) })

  neylivo.messages.onUpload(async (файл) => {
    const s = await наст()
    if (!s.чистить && !s.сжимать) return
    // Трогаем только то, что умеем разобрать обратно в картинку. Всё
    // остальное — чужие файлы, и их дело не наше.
    if (!/^image\\/(jpeg|png|webp)$/.test(файл.type)) return

    let bmp
    try { bmp = await createImageBitmap(new Blob([файл.bytes])) }
    catch (e) { return }   // не картинка на самом деле — пусть уходит как есть

    let ш = bmp.width, в = bmp.height
    if (s.сжимать && Math.max(ш, в) > s.сторона) {
      const k = s.сторона / Math.max(ш, в)
      ш = Math.round(ш * k); в = Math.round(в * k)
    }
    const c = new OffscreenCanvas(ш, в)
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0, ш, в)

    // Перерисовка и есть чистка: в новом файле остаются только пиксели.
    // Прозрачность у JPEG теряется, поэтому png с прозрачностью не трогаем.
    const png = файл.type === 'image/png'
    const blob = await c.convertToBlob(png ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.92 })
    const bytes = await blob.arrayBuffer()

    // Если стало ТЯЖЕЛЕЕ и мы ничего не уменьшали — оставляем как было:
    // «почистил» не должно означать «раздул файл вдвое».
    if (bytes.byteLength >= файл.bytes.byteLength && ш === bmp.width) return

    const имя = файл.name.replace(/\\.(jpe?g|png|webp)$/i, '') + (png ? '.png' : '.jpg')
    return { bytes: bytes, name: имя, type: png ? 'image/png' : 'image/jpeg' }
  })
}
`

// ── 6. Змейка ──────────────────────────────────────────────────────────────
//
// v1.474.0: ПЕРВЫЙ официальный плагин, который правда пользуется всем, что
// нарастало с v1.465: своим окном, холстом, клавишами, геймпадом, таблицами и
// файлами. Написан не «для красоты», а как проверка: сделать настоящую игру —
// единственный способ узнать, работает ли обещанное. Не работало трижды
// (холст в окне не находился, клавиш в окне не было вовсе, а разрешение на
// холст спрашивали чужое) — всё это чинилось по ходу.
const SNAKE = `/**
 * @name Змейка
 * @id ponoi-snake
 * @version 1.0.0
 * @author NeyLivo
 * @description Настоящая игра в своём окне: стрелки, WASD или геймпад. Рекорд сохраняется, звук свой. Команда /змейка.
 * @permissions apps, storage, input, notify, commands
 */
export async function onLoad(neylivo) {
  const КЛЕТКА = 20, ПОЛЕ_Ш = 30, ПОЛЕ_В = 20      // 600×400 пикселей холста
  const ШАГ_МС = 110

  let ctx = null, окно = null, живо = false
  let змея = [], куда = { x: 1, y: 0 }, следующее = { x: 1, y: 0 }, еда = null
  let счёт = 0, рекорд = 0, конец = false, таймер = null

  // ---- звук: делаем сами, скачивать неоткуда ------------------------------
  // Плагин это один файл, звука в нём нет. Но WAV — это заголовок и отсчёты,
  // и собрать короткий писк в самом плагине можно. Дальше он живёт в своих
  // файлах и играется без интернета.
  function писк(частота, мс) {
    const rate = 8000, n = Math.round(rate * мс / 1000)
    const b = new Uint8Array(44 + n)
    const dv = new DataView(b.buffer)
    const пиши = (at, s) => { for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i) }
    пиши(0, 'RIFF'); dv.setUint32(4, 36 + n, true); пиши(8, 'WAVE')
    пиши(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
    dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true)
    пиши(36, 'data'); dv.setUint32(40, n, true)
    for (let i = 0; i < n; i++) {
      const затухание = 1 - i / n
      b[44 + i] = 128 + Math.round(60 * затухание * Math.sin(2 * Math.PI * частота * i / rate))
    }
    return b
  }

  async function звуки() {
    try {
      const есть = (await neylivo.assets.list()).map(a => a.name)
      if (!есть.includes('ням.wav')) await neylivo.assets.put('ням.wav', писк(880, 70))
      if (!есть.includes('конец.wav')) await neylivo.assets.put('конец.wav', писк(220, 260))
    } catch (e) { neylivo.log('звук не собрался: ' + e.message) }
  }
  const играй = (имя) => { neylivo.assets.play(имя, 0.35).catch(() => {}) }

  // ---- рекорды: таблица, а не одна строчка --------------------------------
  async function читайРекорд() {
    try {
      const строки = await neylivo.db.table('счёт').all(50)
      рекорд = строки.reduce((м, с) => Math.max(м, Number(с.очки) || 0), 0)
    } catch (e) { рекорд = 0 }
  }
  async function запишиРекорд(очки) {
    try {
      await neylivo.db.table('счёт').insert({ очки: очки, когда: new Date().toISOString() })
      const строки = await neylivo.db.table('счёт').all(200)
      // Держим последние двадцать: таблица для рекордов, а не для истории.
      if (строки.length > 20) {
        const лишние = строки.slice(0, строки.length - 20)
        for (const с of лишние) await neylivo.db.table('счёт').remove(с.id)
      }
    } catch (e) { neylivo.log('рекорд не записался: ' + e.message) }
  }

  // ---- сама игра -----------------------------------------------------------
  function начать() {
    змея = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }]
    куда = { x: 1, y: 0 }; следующее = { x: 1, y: 0 }
    счёт = 0; конец = false
    кинутьЕду()
  }

  function кинутьЕду() {
    for (let i = 0; i < 200; i++) {
      const п = { x: Math.floor(Math.random() * ПОЛЕ_Ш), y: Math.floor(Math.random() * ПОЛЕ_В) }
      if (!змея.some(с => с.x === п.x && с.y === п.y)) { еда = п; return }
    }
    еда = { x: 0, y: 0 }
  }

  function шаг() {
    if (конец) return
    куда = следующее
    const г = { x: змея[0].x + куда.x, y: змея[0].y + куда.y }
    const встену = г.x < 0 || г.y < 0 || г.x >= ПОЛЕ_Ш || г.y >= ПОЛЕ_В
    const всебя = змея.some(с => с.x === г.x && с.y === г.y)
    if (встену || всебя) {
      конец = true
      играй('конец.wav')
      if (счёт > рекорд) { рекорд = счёт }
      запишиРекорд(счёт)
      neylivo.notify('Змейка: ' + счёт + ' очков' + (счёт >= рекорд ? ' — это рекорд!' : ''))
      рисуй()
      return
    }
    змея.unshift(г)
    if (еда && г.x === еда.x && г.y === еда.y) { счёт += 1; играй('ням.wav'); кинутьЕду() }
    else змея.pop()
    рисуй()
  }

  function рисуй() {
    if (!ctx) return
    ctx.fillStyle = '#1a1b1f'
    ctx.fillRect(0, 0, ПОЛЕ_Ш * КЛЕТКА, ПОЛЕ_В * КЛЕТКА)
    if (еда) {
      ctx.fillStyle = '#f04747'
      ctx.beginPath()
      ctx.arc(еда.x * КЛЕТКА + КЛЕТКА / 2, еда.y * КЛЕТКА + КЛЕТКА / 2, КЛЕТКА / 2 - 2, 0, Math.PI * 2)
      ctx.fill()
    }
    for (let i = 0; i < змея.length; i++) {
      ctx.fillStyle = i === 0 ? '#7aa2ff' : '#5865f2'
      ctx.fillRect(змея[i].x * КЛЕТКА + 1, змея[i].y * КЛЕТКА + 1, КЛЕТКА - 2, КЛЕТКА - 2)
    }
    ctx.fillStyle = '#dcddde'
    ctx.font = '14px sans-serif'
    ctx.fillText('Очки: ' + счёт + '    Рекорд: ' + Math.max(рекорд, счёт), 8, 16)
    if (конец) {
      ctx.fillStyle = 'rgba(0,0,0,0.62)'
      ctx.fillRect(0, 0, ПОЛЕ_Ш * КЛЕТКА, ПОЛЕ_В * КЛЕТКА)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 26px sans-serif'
      ctx.fillText('Всё', 250, 180)
      ctx.font = '15px sans-serif'
      ctx.fillText('Пробел или кнопка геймпада — заново', 150, 210)
    }
  }

  function поверни(dx, dy) {
    // Разворот на месте — это мгновенная смерть, и это не то, чего человек
    // хотел, нажимая клавишу. Такой поворот просто не берём.
    if (dx === -куда.x && dy === -куда.y) return
    следующее = { x: dx, y: dy }
  }

  function нажали(k) {
    if (k === 'ArrowUp' || k === 'w' || k === 'ц') поверни(0, -1)
    else if (k === 'ArrowDown' || k === 's' || k === 'ы') поверни(0, 1)
    else if (k === 'ArrowLeft' || k === 'a' || k === 'ф') поверни(-1, 0)
    else if (k === 'ArrowRight' || k === 'd' || k === 'в') поверни(1, 0)
    else if (k === ' ' && конец) { начать(); рисуй() }
  }

  // ---- окно ----------------------------------------------------------------
  async function открыть() {
    if (окно !== null) return
    await звуки()
    await читайРекорд()
    начать()
    окно = await neylivo.apps.create({
      mode: 'window', title: 'Змейка', icon: 'gamepad', width: 620, height: 470,
      rows: [
        { type: 'canvas', key: 'поле', label: 'Поле', height: 400 },
        { type: 'label', key: 'как', label: 'Управление', value: 'Стрелки, WASD или геймпад' },
      ],
    })
    const холст = await neylivo.ui.getCanvas('поле')
    ctx = холст.getContext('2d')
    живо = true
    рисуй()
    if (таймер) clearInterval(таймер)
    таймер = setInterval(шаг, ШАГ_МС)
  }

  function закрыть() {
    живо = false
    if (таймер) { clearInterval(таймер); таймер = null }
    окно = null; ctx = null
  }

  await neylivo.commands.register('змейка', 'Открыть игру', открыть)

  neylivo.on('key', (e) => { if (e.down) нажали(e.key) })

  neylivo.on('app', (e) => { if (!e.open) закрыть() })

  // Геймпад: крестовина, ручка и любая кнопка «заново».
  neylivo.on('gamepad', (e) => {
    if (!живо) return
    if (e.kind === 'axis') {
      if (e.which === 0) { if (e.value > 0.5) поверни(1, 0); else if (e.value < -0.5) поверни(-1, 0) }
      if (e.which === 1) { if (e.value > 0.5) поверни(0, 1); else if (e.value < -0.5) поверни(0, -1) }
    } else if (e.kind === 'button' && e.pressed) {
      if (e.which === 12) поверни(0, -1)
      else if (e.which === 13) поверни(0, 1)
      else if (e.which === 14) поверни(-1, 0)
      else if (e.which === 15) поверни(1, 0)
      else if (конец) { начать(); рисуй() }
    }
  })

  neylivo.log('Змейка готова: /змейка')
}
`

export const OFFICIAL_PLUGINS: OfficialPlugin[] = [
  { id: 'ponoi-voice-changer', emoji: '🎙️', summary: 'Робот, эхо, рация и ещё два голоса прямо в звонке', code: VOICE },
  { id: 'ponoi-dice', emoji: '🎲', summary: 'Кубик и жребий с подсказками доводов в поле ввода', code: DICE },
  { id: 'ponoi-timer', emoji: '⏰', summary: 'Напоминания, которые переживают перезапуск приложения', code: TIMER },
  { id: 'ponoi-afk', emoji: '💤', summary: 'Кнопка «меня нет»: активность и ответ упомянувшим', code: AFK },
  { id: 'ponoi-read-receipts', emoji: '👀', summary: 'Видно, когда собеседник прочитал твоё сообщение в личке', code: READS },
  { id: 'ponoi-notes', emoji: '📝', summary: 'Свои заметки отдельной вкладкой, с поиском', code: NOTES },
  { id: 'ponoi-secret', emoji: '🔐', summary: 'Прячет сообщения в канале за секретным словом', code: SECRET },
  { id: 'ponoi-weather', emoji: '🌦', summary: 'Погода панелью в чате и командой, без ключей', code: WEATHER },
  { id: 'ponoi-music-waves', emoji: '🌊', summary: 'Живые волны в плеере, пока играет музыка', code: VIZ },
  { id: 'ponoi-photo-clean', emoji: '🧼', summary: 'Снимает с фотографий геометку и модель телефона перед отправкой', code: EXIF },
  { id: 'ponoi-snake', emoji: '🐍', summary: 'Настоящая игра в своём окне: клавиши, геймпад, рекорды', code: SNAKE },
  { id: 'ponoi-soft-light', emoji: '🌙', summary: 'Приглушает цвета приложения — вечером глазам легче', code: SOFT },
]


/**
 * Наш ли это плагин (v1.486.0).
 *
 * Сверяем КОД, а не @id и не @author. Иначе кто угодно назвал бы свой файл
 * «ponoi-snake» с автором «NeyLivo» и получил зелёную отметку и спокойный экран
 * установки — то есть отметка «от создателей» стала бы способом обмана.
 *
 * Пробелы по краям и переводы строк не считаем: файл мог пройти через чат,
 * буфер обмена и редактор, а от этого он не перестаёт быть нашим.
 */
const ровно = (s: string) => String(s ?? '').replace(/\r\n?/g, '\n').trim()

export function isOfficialCode(code: string): boolean {
  const c = ровно(code)
  if (!c) return false
  return OFFICIAL_PLUGINS.some(p => ровно(p.code) === c)
}
