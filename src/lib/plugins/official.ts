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
 * @author Ponoi
 * @description Настоящая игра в своём окне: стрелки, WASD или геймпад. Рекорд сохраняется, звук свой. Команда /змейка.
 * @permissions apps, storage, input, notify, commands
 */
export async function onLoad(ponoi) {
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
      const есть = (await ponoi.assets.list()).map(a => a.name)
      if (!есть.includes('ням.wav')) await ponoi.assets.put('ням.wav', писк(880, 70))
      if (!есть.includes('конец.wav')) await ponoi.assets.put('конец.wav', писк(220, 260))
    } catch (e) { ponoi.log('звук не собрался: ' + e.message) }
  }
  const играй = (имя) => { ponoi.assets.play(имя, 0.35).catch(() => {}) }

  // ---- рекорды: таблица, а не одна строчка --------------------------------
  async function читайРекорд() {
    try {
      const строки = await ponoi.db.table('счёт').all(50)
      рекорд = строки.reduce((м, с) => Math.max(м, Number(с.очки) || 0), 0)
    } catch (e) { рекорд = 0 }
  }
  async function запишиРекорд(очки) {
    try {
      await ponoi.db.table('счёт').insert({ очки: очки, когда: new Date().toISOString() })
      const строки = await ponoi.db.table('счёт').all(200)
      // Держим последние двадцать: таблица для рекордов, а не для истории.
      if (строки.length > 20) {
        const лишние = строки.slice(0, строки.length - 20)
        for (const с of лишние) await ponoi.db.table('счёт').remove(с.id)
      }
    } catch (e) { ponoi.log('рекорд не записался: ' + e.message) }
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
      ponoi.notify('Змейка: ' + счёт + ' очков' + (счёт >= рекорд ? ' — это рекорд!' : ''))
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
    окно = await ponoi.apps.create({
      mode: 'window', title: 'Змейка', icon: 'gamepad', width: 620, height: 470,
      rows: [
        { type: 'canvas', key: 'поле', label: 'Поле', height: 400 },
        { type: 'label', key: 'как', label: 'Управление', value: 'Стрелки, WASD или геймпад' },
      ],
    })
    const холст = await ponoi.ui.getCanvas('поле')
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

  await ponoi.commands.register('змейка', 'Открыть игру', открыть)

  ponoi.on('key', (e) => { if (e.down) нажали(e.key) })

  ponoi.on('app', (e) => { if (!e.open) закрыть() })

  // Геймпад: крестовина, ручка и любая кнопка «заново».
  ponoi.on('gamepad', (e) => {
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

  ponoi.log('Змейка готова: /змейка')
}
`

export const OFFICIAL_PLUGINS: OfficialPlugin[] = [
  { id: 'ponoi-voice-changer', emoji: '🎙️', summary: 'Робот, эхо, рация и ещё два голоса прямо в звонке', code: VOICE },
  { id: 'ponoi-dice', emoji: '🎲', summary: 'Кубик, монетка и «выбери за меня» в чате', code: DICE },
  { id: 'ponoi-timer', emoji: '⏰', summary: 'Напоминание через заданное время', code: TIMER },
  { id: 'ponoi-afk', emoji: '💤', summary: 'Отвечает за тебя тем, кто упомянул, пока тебя нет', code: AFK },
  { id: 'ponoi-snake', emoji: '🐍', summary: 'Настоящая игра в своём окне: клавиши, геймпад, рекорды', code: SNAKE },
  { id: 'ponoi-soft-light', emoji: '🌙', summary: 'Приглушает резкий текст — ночью читать легче', code: SOFT },
]
