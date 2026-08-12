// Подставная база для снимков сайта. Используется ТОЛЬКО сборкой
// scripts/site-shots.mjs — в приложение этот файл не попадает никогда.
//
// ЗАЧЕМ ОН ВООБЩЕ НУЖЕН.
//
// Владелец однажды сказал прямо: «у тебя на примерах красивей чем в
// реальности». Он был прав: снимки для сайта рисовались с разметки, написанной
// мной «по мотивам» приложения, и такая разметка всегда аккуратнее настоящей.
// Показывать её на официальном сайте — это врать картинкой.
//
// Настоящие компоненты (`__real_view.tsx`) без входа поднимают только настройки:
// список бесед и сервер падают на `user.id`, а клиент базы подставную сессию
// проверяет и отбрасывает. Поэтому здесь подменяется САМ КЛИЕНТ: экраны те же,
// компоненты те же, стили те же — другие только строки, которые приезжают
// «из базы».
//
// ЧЕСТНОСТЬ. Это не рисунок интерфейса: рисует React из настоящего кода. Что
// подставлено — переписка и названия каналов, то есть ровно то, что на снимке
// у любого продукта своё. Ни одной кнопки, которой нет, ни одного экрана,
// которого нет, тут появиться не может: их неоткуда взять.

// ── Фикстуры ────────────────────────────────────────────────────────────────

const Я = '11111111-1111-4111-8111-111111111111'
const ВАНЯ = '22222222-2222-4222-8222-222222222222'
const МИЛА = '33333333-3333-4333-8333-333333333333'
const СЕРВЕР = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const КАНАЛ = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const ТРЕД = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'

const час = (ч: number, м: number) => {
  const d = new Date()
  d.setHours(ч, м, 0, 0)
  return d.toISOString()
}

export const ФИКСТУРЫ: Record<string, any[]> = {
  profiles: [
    { id: Я, username: 'nubas', display_name: 'nubas', avatar_url: null, about: 'Собираю Ponoi', accent: '#8ea1ff', status: 'online' },
    { id: ВАНЯ, username: 'vanya', display_name: 'Ваня', avatar_url: null, about: null, accent: '#7ecb8f', status: 'online' },
    { id: МИЛА, username: 'mila', display_name: 'Мила', avatar_url: null, about: null, accent: '#e0a3d6', status: 'idle' },
  ],
  servers: [
    { id: СЕРВЕР, name: 'Мастерская', owner: Я, icon_url: null, banner_url: null, description: 'Про сборки и плагины' },
  ],
  server_members: [
    { server_id: СЕРВЕР, user_id: Я, member_name: 'nubas', joined_at: час(9, 0) },
    { server_id: СЕРВЕР, user_id: ВАНЯ, member_name: 'Ваня', joined_at: час(9, 5) },
    { server_id: СЕРВЕР, user_id: МИЛА, member_name: 'Мила', joined_at: час(9, 7) },
  ],
  channels: [
    // «болталка», а не «общий», намеренно: приложение открывает первый канал
    // по алфавиту, и с «общим» снимок всегда получался пустым каналом «музыка».
    { id: КАНАЛ, server_id: СЕРВЕР, name: 'болталка', kind: 'text', position: 0, settings: {} },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', server_id: СЕРВЕР, name: 'плагины', kind: 'text', position: 1, settings: {} },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', server_id: СЕРВЕР, name: 'музыка', kind: 'text', position: 2, settings: {} },
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', server_id: СЕРВЕР, name: 'Голосовая', kind: 'voice', position: 3, settings: {} },
  ],
  messages: [
    { id: 'm1', channel_id: КАНАЛ, author: ВАНЯ, author_name: 'Ваня', content: 'Собрал плагин на выходных — переводит входящие прямо в сообщении', created_at: час(14, 2), thread_id: null },
    { id: 'm2', channel_id: КАНАЛ, author: Я, author_name: 'nubas', content: 'Покажи файл, поставлю у себя', created_at: час(14, 3), thread_id: null },
    { id: 'm3', channel_id: КАНАЛ, author: ВАНЯ, author_name: 'Ваня', content: 'Держи — один .ponoi, ставится за секунду', created_at: час(14, 4), thread_id: null },
    { id: 'm4', channel_id: КАНАЛ, author: МИЛА, author_name: 'Мила', content: 'А разрешения он какие просит?', created_at: час(14, 6), thread_id: null },
    { id: 'm5', channel_id: КАНАЛ, author: ВАНЯ, author_name: 'Ваня', content: 'Только чтение сообщений и сеть на один домен. Перед установкой всё показано списком', created_at: час(14, 7), thread_id: ТРЕД },
  ],
  dm_threads: [
    { id: 'd1', user_a: Я, user_b: ВАНЯ, created_at: час(10, 0), last_at: час(14, 20) },
    { id: 'd2', user_a: Я, user_b: МИЛА, created_at: час(11, 0), last_at: час(13, 40) },
  ],
  dm_participants: [
    { thread_id: 'd1', user_id: Я }, { thread_id: 'd1', user_id: ВАНЯ },
    { thread_id: 'd2', user_id: Я }, { thread_id: 'd2', user_id: МИЛА },
  ],
  dm_messages: [
    { id: 'x1', thread_id: 'd1', author: ВАНЯ, content: 'Позвонишь вечером? Хочу показать сцену в мастерской', created_at: час(14, 18) },
    { id: 'x2', thread_id: 'd1', author: Я, content: 'Давай в девять', created_at: час(14, 20) },
  ],
  music_tracks: [
    { id: 't1', owner: Я, title: 'Ночная смена', author: 'Кассета', source: 'file', duration: 214, cover_url: null, created_at: час(12, 0) },
    { id: 't2', owner: Я, title: 'Тихий этаж', author: 'Кассета', source: 'file', duration: 187, cover_url: null, created_at: час(12, 5) },
    { id: 't3', owner: Я, title: 'Первый снег', author: 'Полдень', source: 'file', duration: 243, cover_url: null, created_at: час(12, 9) },
  ],
}

// ── Построитель запроса ─────────────────────────────────────────────────────
//
// Повторяет ровно ту часть PostgREST, которой пользуется приложение: цепочка
// уточнений, а в конце — await либо .single(). Уточнения не выбрасываются, а
// ПРИМЕНЯЮТСЯ: иначе запрос «сообщения этого канала» вернул бы сообщения всех
// каналов сразу, и снимок показал бы то, чего в приложении не бывает.

type Строка = Record<string, any>

function отфильтровать(строки: Строка[], условия: Array<[string, string, any]>): Строка[] {
  return строки.filter((р) => условия.every(([вид, поле, знач]) => {
    const v = р[поле]
    if (вид === 'eq') return String(v) === String(знач)
    if (вид === 'neq') return String(v) !== String(знач)
    if (вид === 'in') return (знач as any[]).map(String).includes(String(v))
    if (вид === 'is') return знач === null ? v === null || v === undefined : v === знач
    return true
  }))
}

function запрос(table: string) {
  const условия: Array<[string, string, any]> = []
  let поле: string | null = null
  let по: string | null = null
  let обратно = false
  let предел: number | null = null

  const данные = () => {
    let r = отфильтровать(ФИКСТУРЫ[table] ?? [], условия)
    if (по) r = [...r].sort((a, b) => String(a[по!]).localeCompare(String(b[по!])) * (обратно ? -1 : 1))
    if (предел != null) r = r.slice(0, предел)
    return r
  }

  const b: any = {
    select: (_c?: string) => b,
    eq: (f: string, v: any) => { условия.push(['eq', f, v]); return b },
    neq: (f: string, v: any) => { условия.push(['neq', f, v]); return b },
    in: (f: string, v: any[]) => { условия.push(['in', f, v]); return b },
    is: (f: string, v: any) => { условия.push(['is', f, v]); return b },
    not: () => b, or: () => b, filter: () => b, contains: () => b, overlaps: () => b,
    gt: () => b, gte: () => b, lt: () => b, lte: () => b, like: () => b, ilike: () => b,
    order: (f: string, o?: { ascending?: boolean }) => { по = f; обратно = o?.ascending === false; return b },
    limit: (n: number) => { предел = n; return b },
    range: () => b,
    abortSignal: () => b,
    // Запись молча «удаётся»: снимок делается с готового состояния, и
    // единственное, что здесь важно, — чтобы экран не показал ошибку.
    insert: (v: any) => { поле = 'insert'; return { ...b, __v: v } },
    update: () => { поле = 'update'; return b },
    upsert: () => { поле = 'upsert'; return b },
    delete: () => { поле = 'delete'; return b },
    single: () => Promise.resolve({ data: данные()[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: данные()[0] ?? null, error: null }),
    then: (res: any, rej?: any) => {
      const r = поле ? [] : данные()
      if ((globalThis as any).__ШУМ) console.log('[фейк] ' + table + ' -> ' + r.length + '  ' + JSON.stringify(условия))
      // ЗАДЕРЖКА ОБЯЗАТЕЛЬНА, И ЭТО НЕ УКРАШЕНИЕ.
      //
      // Без неё ответ приходит в том же микрозадании, что и запрос, — раньше,
      // чем React успевает выполнить эффекты. А приложение на это опирается:
      // в ServerView ответ отбрасывается, если curChannelRef уже указывает на
      // другой канал, а этот ref заполняется как раз эффектом. С мгновенным
      // ответом ref ещё пуст, ответ отбрасывается, и лента остаётся пустой —
      // снимок сервера выходил с экраном «Добро пожаловать», хотя сообщения
      // приезжали. Настоящая сеть отвечает за десятки миллисекунд, и здесь
      // ровно это и воспроизводится.
      return new Promise<any>((r2) => setTimeout(() => r2({ data: r, error: null, count: r.length }), 30))
        .then(res, rej)
    },
  }
  return b
}

// ── Каналы реального времени ────────────────────────────────────────────────
//
// Ничего не приходит и приходить не должно: снимок статичен. Важно только, что
// подписка «удалась», — иначе экраны, которые ждут SUBSCRIBED, остаются в
// состоянии загрузки и на снимке видно крутилку вместо интерфейса.
function канал() {
  const ch: any = {
    on: () => ch,
    subscribe: (cb?: (s: string) => void) => { if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return ch },
    track: () => Promise.resolve('ok'),
    untrack: () => Promise.resolve('ok'),
    send: () => Promise.resolve('ok'),
    presenceState: () => ({}),
    unsubscribe: () => Promise.resolve('ok'),
  }
  return ch
}

const СЕССИЯ = {
  access_token: 'fake', refresh_token: 'fake', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: Я, aud: 'authenticated', role: 'authenticated', email: 'nubas@example.com',
    app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
  },
}

export const supabase: any = {
  from: (t: string) => запрос(t),
  rpc: (_n: string, _a?: any) => Promise.resolve({ data: null, error: null }),
  channel: () => канал(),
  removeChannel: () => Promise.resolve('ok'),
  removeAllChannels: () => Promise.resolve([]),
  getChannels: () => [],
  auth: {
    getSession: () => Promise.resolve({ data: { session: СЕССИЯ }, error: null }),
    getUser: () => Promise.resolve({ data: { user: СЕССИЯ.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    signOut: () => Promise.resolve({ error: null }),
    updateUser: () => Promise.resolve({ data: { user: СЕССИЯ.user }, error: null }),
    signInWithPassword: () => Promise.resolve({ data: { session: СЕССИЯ }, error: null }),
  },
  storage: {
    from: () => ({
      getPublicUrl: (p: string) => ({ data: { publicUrl: 'https://example.invalid/' + p } }),
      createSignedUrl: () => Promise.resolve({ data: null, error: new Error('снимок') }),
      createSignedUrls: () => Promise.resolve({ data: [], error: null }),
      upload: () => Promise.resolve({ data: null, error: null }),
      download: () => Promise.resolve({ data: null, error: null }),
      list: () => Promise.resolve({ data: [], error: null }),
      remove: () => Promise.resolve({ data: null, error: null }),
    }),
  },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
}

// Для отладки стенда: тем же клиентом можно спросить из консоли пробы.
;(globalThis as any).__ФЕЙК = supabase

export const ЛЮДИ = { Я, ВАНЯ, МИЛА, СЕРВЕР, КАНАЛ }
