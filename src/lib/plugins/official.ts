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
 * @author Ponoi
 * @description Меняет твой голос в звонке: робот, эхо, рация, хор, подводный. Команда /голос и кнопка в звонке.
 * @permissions voice, commands, notify, settings
 */
export async function onLoad(ponoi) {
  const list = await ponoi.voice.list()
  const names = list.map(e => e.label).join(', ')

  await ponoi.commands.register('голос', 'Сменить свой голос в звонке: ' + names, async (arg) => {
    const want = String(arg || '').trim().toLowerCase()
    if (!want) {
      const cur = await ponoi.voice.current()
      const curLabel = (list.find(e => e.id === cur) || {}).label || cur
      ponoi.notify('Сейчас: ' + curLabel + '. Доступно: ' + names)
      return
    }
    const found = list.find(e => e.label.toLowerCase() === want || e.id === want)
    if (!found) { ponoi.notify('Нет такого голоса. Есть: ' + names); return }
    const ok = await ponoi.voice.setEffect(found.id)
    ponoi.notify(ok ? 'Голос: ' + found.label : 'Ты сейчас не в звонке — голос включится со следующего')
  })

  await ponoi.ui.addSettingsPage({
    title: 'Смена голоса',
    rows: [{
      type: 'select',
      key: 'default',
      label: 'Голос по умолчанию',
      description: 'Включается сам при входе в звонок',
      value: await ponoi.voice.current(),
      options: list.map(e => ({ value: e.id, label: e.label })),
    }],
  })

  ponoi.on('settings', async (e) => {
    if (e.key !== 'default') return
    // setEffect запоминает выбор сам — он же станет голосом следующего звонка.
    const now = await ponoi.voice.setEffect(e.value)
    const label = (list.find(x => x.id === e.value) || {}).label || e.value
    ponoi.notify(now ? 'Голос: ' + label : 'Голос ' + label + ' включится со следующего звонка')
  })
}
`

// ── 2. Кубик и монетка ─────────────────────────────────────────────────────
const DICE = `/**
 * @name Кубик и монетка
 * @id ponoi-dice
 * @version 1.0.0
 * @author Ponoi
 * @description /кубик, /монетка и /выбери — быстро решить спор прямо в чате.
 * @permissions commands, messages.write
 */
export async function onLoad(ponoi) {
  const rnd = (n) => Math.floor(Math.random() * n)

  await ponoi.commands.register('кубик', 'Бросить кубик: /кубик или /кубик 20', async (arg) => {
    const sides = Math.min(1000, Math.max(2, parseInt(String(arg || '6'), 10) || 6))
    await ponoi.messages.send('🎲 Кубик на ' + sides + ': выпало ' + (rnd(sides) + 1))
  })

  await ponoi.commands.register('монетка', 'Орёл или решка', async () => {
    await ponoi.messages.send(rnd(2) ? '🪙 Орёл' : '🪙 Решка')
  })

  await ponoi.commands.register('выбери', 'Выбрать одно из: /выбери чай | кофе | сон', async (arg) => {
    const parts = String(arg || '').split(/[|,]/).map(s => s.trim()).filter(Boolean)
    if (parts.length < 2) { await ponoi.messages.send('Дай хотя бы два варианта через |'); return }
    await ponoi.messages.send('🤔 Я выбираю: **' + parts[rnd(parts.length)] + '**')
  })
}
`

// ── 3. Таймер ──────────────────────────────────────────────────────────────
const TIMER = `/**
 * @name Таймер
 * @id ponoi-timer
 * @version 1.0.0
 * @author Ponoi
 * @description /таймер 10м чай — напомнит уведомлением, когда время выйдет.
 * @permissions commands, notify
 */
export async function onLoad(ponoi) {
  // Живёт, пока открыто приложение: таймер на выключенном компьютере не сработал
  // бы всё равно, а обещать «напомню через сутки» и не напомнить — обман.
  await ponoi.commands.register('таймер', 'Напомнить через время: /таймер 10м заварить чай', async (arg) => {
    const m = String(arg || '').trim().match(/^(\\d+)\\s*([сcмmчh]?)\\s*(.*)$/i)
    if (!m) { ponoi.notify('Формат: /таймер 10м текст'); return }
    const n = parseInt(m[1], 10)
    const unit = (m[2] || 'м').toLowerCase()
    const mult = (unit === 'с' || unit === 'c') ? 1000 : (unit === 'ч' || unit === 'h') ? 3600000 : 60000
    const ms = n * mult
    if (!n || ms > 12 * 3600000) { ponoi.notify('От 1 секунды до 12 часов'); return }
    const text = (m[3] || '').trim() || 'Время вышло';
    ponoi.notify('Таймер поставлен: ' + n + (unit || 'м'))
    setTimeout(() => ponoi.notify('⏰ ' + text), ms)
  })
}
`

// ── 4. Автоответ «меня нет» ────────────────────────────────────────────────
const AFK = `/**
 * @name Автоответ «меня нет»
 * @id ponoi-afk
 * @version 1.0.0
 * @author Ponoi
 * @description Пока включён, отвечает один раз каждому, кто тебя упомянул: «отошёл, скоро буду».
 * @permissions messages.read, messages.write, settings, storage, notify
 */
export async function onLoad(ponoi) {
  const answered = new Set()

  const text = async () => (await ponoi.storage.get('text')) || 'Отошёл — отвечу, как вернусь.';
  const isOn = async () => !!(await ponoi.storage.get('on'))

  await ponoi.ui.addSettingsPage({
    title: 'Автоответ «меня нет»',
    rows: [
      { type: 'toggle', key: 'on', label: 'Включён', description: 'Отвечать на упоминания, пока тебя нет', value: await isOn() },
      { type: 'text', key: 'text', label: 'Текст ответа', placeholder: 'Отошёл — отвечу, как вернусь.', value: await text() },
      { type: 'button', key: 'reset', label: 'Отвечать всем заново', description: 'Каждому отвечаем один раз — это сбрасывает память', onClick: () => { answered.clear(); ponoi.notify('Готово') } },
    ],
  })

  await ponoi.on('message', async (msg) => {
    if (!(await isOn())) return
    if (!msg.mentionsMe) return
    if (answered.has(msg.author)) return
    answered.add(msg.author)
    await ponoi.messages.send(await text())
  })
}
`

// ── 5. Ночная тема помягче ─────────────────────────────────────────────────
const SOFT = `/**
 * @name Мягкий свет
 * @id ponoi-soft-light
 * @version 1.0.0
 * @author Ponoi
 * @description Убирает резкий белый текст и жёсткие границы — глазам ночью легче. Сила настраивается.
 * @permissions css, settings, storage
 */
export async function onLoad(ponoi) {
  const level = async () => String((await ponoi.storage.get('level')) || 'mid')

  function css(l) {
    const dim = l === 'low' ? '0.90' : l === 'high' ? '0.72' : '0.82';
    const soft = l === 'low' ? '0.06' : l === 'high' ? '0.16' : '0.10';
    return [
      '.msg-txt, .me-nm, .ch-nm { filter: brightness(' + dim + '); }',
      '.msg:hover { background: rgba(var(--ov), ' + soft + ') !important; }',
      '.ch, .plug-card, .devp-card { border-radius: 10px; }',
    ].join('\\n')
  }

  await ponoi.css(css(await level()))

  await ponoi.ui.addSettingsPage({
    title: 'Мягкий свет',
    rows: [{
      type: 'select', key: 'level', label: 'Сила', description: 'Насколько приглушать текст',
      value: await level(),
      options: [
        { value: 'low', label: 'Слегка' },
        { value: 'mid', label: 'Средне' },
        { value: 'high', label: 'Сильно' },
      ],
    }],
  })

  ponoi.on('settings', async (e) => {
    if (e.key === 'level') await ponoi.css(css(String(e.value)))
  })
}
`

export const OFFICIAL_PLUGINS: OfficialPlugin[] = [
  { id: 'ponoi-voice-changer', emoji: '🎙️', summary: 'Робот, эхо, рация и ещё два голоса прямо в звонке', code: VOICE },
  { id: 'ponoi-dice', emoji: '🎲', summary: 'Кубик, монетка и «выбери за меня» в чате', code: DICE },
  { id: 'ponoi-timer', emoji: '⏰', summary: 'Напоминание через заданное время', code: TIMER },
  { id: 'ponoi-afk', emoji: '💤', summary: 'Отвечает за тебя тем, кто упомянул, пока тебя нет', code: AFK },
  { id: 'ponoi-soft-light', emoji: '🌙', summary: 'Приглушает резкий текст — ночью читать легче', code: SOFT },
]
