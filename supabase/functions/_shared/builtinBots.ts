// v1.333.0: боты «от нас» — выполняются внутри наших же Edge Function.
//
// Обычный бот живёт снаружи: Ponoi шлёт ему подписанный POST на webhook_url, тот
// отвечает. У готовых ботов никакого «снаружи» нет и быть не должно — иначе
// пришлось бы держать отдельный сервер, а пока он не поднят, бот в каталоге был
// бы кнопкой-обманкой. Поэтому их логика лежит здесь, и bot-dispatch/bot-interact
// выполняют её сами, никуда не ходя.
//
// Вид бота (kind) проставляется при создании сервисным ключом и после этого не
// меняется (триггер bot_guard_builtin, миграция 89) — иначе любой приписал бы
// своему боту чужую логику.

export interface BuiltinBot {
  kind: string
  name: string
  emoji: string
  summary: string
  description: string
  commands: { name: string; description: string }[]
}

/** Каталог готовых ботов. Клиент показывает ровно этот список. */
export const BUILTIN_BOTS: BuiltinBot[] = [
  {
    kind: 'dice', name: 'Кубик', emoji: '🎲',
    summary: 'Кубик, монетка и «выбери за меня» — решить спор в чате',
    description: 'Команды:\n/кубик — бросить шестигранный, /кубик 20 — двадцатигранный\n/монетка — орёл или решка\n/выбери чай | кофе | сон — выберет один из вариантов',
    commands: [
      { name: 'кубик', description: 'Бросить кубик: /кубик или /кубик 20' },
      { name: 'монетка', description: 'Орёл или решка' },
      { name: 'выбери', description: 'Выбрать один вариант: /выбери чай | кофе' },
    ],
  },
  {
    kind: 'poll', name: 'Опросы', emoji: '📊',
    summary: 'Быстрый опрос с вариантами прямо в канале',
    description: 'Команда:\n/опрос Что берём? | пиццу | суши | ничего\n\nБот пришлёт вопрос с пронумерованными вариантами — голосуют реакциями под сообщением.',
    commands: [{ name: 'опрос', description: 'Опрос: /опрос вопрос | вариант | вариант' }],
  },
  {
    kind: 'stats', name: 'Статистика', emoji: '📈',
    summary: 'Сколько сообщений в канале за сутки и кто написал больше всех',
    description: 'Команда:\n/статистика — сообщения в этом канале за последние сутки и тройка самых разговорчивых.\n\nСчитает только этот канал и только за сутки: переписку бот никуда не сохраняет и наружу не отдаёт.',
    commands: [{ name: 'статистика', description: 'Сообщения в канале за сутки' }],
  },
  {
    kind: 'greeter', name: 'Встречающий', emoji: '👋',
    summary: 'Здоровается с теми, кто только что вступил на сервер',
    description: 'Ничего настраивать не нужно: как только человек вступает на сервер, бот пишет ему приветствие в том же канале, где появилась строчка о вступлении.\n\nЕсли приветственные сообщения выключены в настройках сервера, бот молчит.',
    commands: [],
  },
  {
    kind: 'eightball', name: 'Шар предсказаний', emoji: '🔮',
    summary: 'Отвечает на любой вопрос «да», «нет» или уклончиво',
    description: 'Команда:\n/шар Стоит ли деплоить в пятницу?\n\nОтвечает одной из двадцати классических фраз. Ответ случайный — это игра, а не совет.',
    commands: [{ name: 'шар', description: 'Задать вопрос шару предсказаний' }],
  },
]

/**
 * Бот с заранее записанными ответами (v1.344.0). В каталоге его нет: это не
 * готовый бот «от нас», а пустая заготовка, которую человек наполняет сам —
 * пишет команду и что на неё отвечать. Выполняется тоже здесь, своего сервера
 * ему не нужно.
 */
export const SIMPLE_KIND = 'simple'

export const isBuiltinKind = (k: unknown): k is string =>
  typeof k === 'string' && (k === SIMPLE_KIND || BUILTIN_BOTS.some(b => b.kind === k))

export const builtinBot = (kind: string): BuiltinBot | undefined =>
  BUILTIN_BOTS.find(b => b.kind === kind)

const rnd = (n: number) => Math.floor(Math.random() * n)

const BALL = [
  'Бесспорно', 'Мне кажется — да', 'Определённо да', 'Пока неясно, попробуй снова',
  'Даже не думай', 'Весьма сомнительно', 'Знаки говорят — да', 'Спроси позже',
  'Не могу предсказать', 'Хорошие перспективы', 'Никаких сомнений', 'Мой ответ — нет',
  'По моим данным — нет', 'Перспективы так себе', 'Лучше не рассказывать', 'Да',
  'Нет', 'Скорее всего', 'Сконцентрируйся и спроси опять', 'Ясное дело, нет',
]

/**
 * Слэш-команда встроенного бота. Возвращает текст ответа или null, если команда
 * не его.
 *
 * @param db admin-клиент Supabase: нужен только «Статистике», и только на чтение
 *   сообщений того же канала, где команду и позвали.
 */
export async function runBuiltinCommand(
  kind: string, command: string, arg: string, channelId: string, db: any, appId?: string,
): Promise<string | null> {
  const a = String(arg ?? '').trim()

  // Ответ такого бота лежит в его же команде — там, куда владелец его вписал.
  if (kind === SIMPLE_KIND) {
    if (!appId) return null
    const { data } = await db.from('bot_commands')
      .select('reply').eq('bot_app_id', appId).eq('name', command).maybeSingle()
    const reply = (data as any)?.reply
    if (!reply) return null
    // {текст} — то, что человек дописал после команды. Больше никакой подстановки:
    // всё остальное пусть остаётся ровно тем, что владелец написал.
    return String(reply).replace(/\{текст\}/g, a).slice(0, 2000)
  }
  switch (kind + ':' + command) {
    case 'dice:кубик': {
      const sides = Math.min(1000, Math.max(2, parseInt(a || '6', 10) || 6))
      return `🎲 Кубик на ${sides}: выпало **${rnd(sides) + 1}**`
    }
    case 'dice:монетка':
      return rnd(2) ? '🪙 Орёл' : '🪙 Решка'
    case 'dice:выбери': {
      const parts = a.split(/[|,]/).map(s => s.trim()).filter(Boolean)
      if (parts.length < 2) return 'Дай хотя бы два варианта через | — например: /выбери чай | кофе'
      return `🤔 Я выбираю: **${parts[rnd(parts.length)]}**`
    }
    case 'poll:опрос': {
      const parts = a.split('|').map(s => s.trim()).filter(Boolean)
      if (parts.length < 3) return 'Формат: /опрос Вопрос | вариант | вариант (минимум два варианта)'
      const [question, ...options] = parts
      const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
      const lines = options.slice(0, 10).map((o, i) => `${nums[i]} ${o}`)
      return `📊 **${question}**\n${lines.join('\n')}\n\nГолосуй реакцией под сообщением.`
    }
    case 'stats:статистика': {
      const since = new Date(Date.now() - 24 * 3600_000).toISOString()
      const { data } = await db.from('messages')
        .select('author_name, created_at').eq('channel_id', channelId).gte('created_at', since).limit(2000)
      const rows: any[] = data ?? []
      if (rows.length === 0) return '📈 За сутки в этом канале ни одного сообщения.'
      const by: Record<string, number> = {}
      for (const r of rows) by[r.author_name] = (by[r.author_name] ?? 0) + 1
      const top = Object.entries(by).sort((x, y) => y[1] - x[1]).slice(0, 3)
      const list = top.map(([n, c], i) => `${i + 1}. ${n} — ${c}`).join('\n')
      return `📈 За сутки: **${rows.length}** сообщений\n${list}`
    }
    case 'eightball:шар': {
      if (!a) return '🔮 Задай вопрос: /шар Стоит ли деплоить в пятницу?'
      return `🔮 ${BALL[rnd(BALL.length)]}`
    }
    default:
      return null
  }
}

/**
 * Реакция встроенного бота на новое сообщение. Возвращает текст или null —
 * молчание тут норма, отвечает только «Встречающий» и только на строчку о
 * вступлении, которую пишет сама база (миграция 86).
 */
export function runBuiltinMessage(kind: string, msg: { content?: string; author_name?: string }): string | null {
  if (kind !== 'greeter') return null
  const c = String(msg?.content ?? '')
  // Формат системной строки — sys:join (см. src/lib/sysmsg.ts). На обычные
  // сообщения бот не отвечает вовсе: болтливый бот в чате хуже отсутствующего.
  if (!c.startsWith('sys:join')) return null
  const who = String(msg?.author_name ?? '').trim()
  return who ? `👋 ${who}, привет! Рады тебя видеть.` : '👋 Привет и добро пожаловать!'
}
