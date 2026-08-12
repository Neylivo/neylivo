// v1.453.0: ИИ-подсказки по игре — прямо в панели прохождения.
//
// Что это. Спрашиваешь «где найти ключ от ворот», а к вопросу само собой
// прикладывается, где ты сейчас: игра, миссия, проценты и своя заметка (см.
// campaign.ts, askPrompt). Ответ приходит по словам, а не одним куском через
// минуту.
//
// Откуда берётся ответ, и это надо понимать. Своей модели у приложения нет и не
// будет: держать её значило бы платить за каждый вопрос каждого человека.
// Поэтому ключ приносит сам человек — от OpenAI, от Anthropic или от любого
// сервиса, говорящего на языке OpenAI (их десятки, включая бесплатные). Ключ
// лежит ТОЛЬКО на этом устройстве: он не уходит ни в присутствие, ни в базу, ни
// на наш сервер, а только в тот сервис, чей он есть.
//
// Почему запрос идёт из приложения, а не через плагин. Плагину сеть открыта
// (neylivo.net.stream), и через него это тоже можно — но требовать от человека
// сначала написать плагин, чтобы спросить про игру, глупо.
//
// Проверки: src/lib/__ui_test.ts (npm run test:ui) — разбор потока и сборка
// запроса; живой вызов к модели, разумеется, проверяется только ключом.

// v1.459.0: Gemini — по прямой просьбе владельца. У Google свой вид запроса и
// свой вид потока, поэтому он ветка, а не «ещё один OpenAI-совместимый».
export type AiProvider = 'gemini' | 'openai' | 'anthropic'

export interface AiConfig {
  provider: AiProvider
  key: string
  model: string
  /** Свой адрес — для сервисов, говорящих на языке OpenAI. Пусто — обычный. */
  base?: string
}

const KEY = 'ponoi_game_ai_v1'

export const DEFAULT_MODEL: Record<AiProvider, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
}

/** Где взять ключ — это первое, что спрашивает человек. */
export const KEY_HELP: Record<AiProvider, string> = {
  gemini: 'Ключ бесплатно: aistudio.google.com/apikey',
  openai: 'Ключ: platform.openai.com/api-keys',
  anthropic: 'Ключ: console.anthropic.com',
}

export function loadAi(): AiConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    const provider: AiProvider = raw.provider === 'anthropic' ? 'anthropic'
      : raw.provider === 'openai' ? 'openai' : 'gemini'
    return {
      provider,
      key: String(raw.key ?? ''),
      model: String(raw.model || DEFAULT_MODEL[provider]),
      base: raw.base ? String(raw.base) : undefined,
    }
  } catch { return { provider: 'gemini', key: '', model: DEFAULT_MODEL.gemini } }
}

export function saveAi(c: AiConfig) {
  try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* приватный режим */ }
}

export const aiReady = (c: AiConfig) => !!c.key.trim()

/** Куда стучаться и чем подписываться. Отдельной функцией — чтобы проверить
 *  состав запроса, не делая самого запроса. */
export function buildRequest(c: AiConfig, prompt: string): { url: string; headers: Record<string, string>; body: string } {
  if (c.provider === 'gemini') {
    // Google: ключ в адресе, поток включается alt=sse. Заголовка с ключом у них
    // нет вовсе — если поставить его, запрос уйдёт неподписанным.
    const base = c.base || 'https://generativelanguage.googleapis.com'
    return {
      url: base + '/v1beta/models/' + encodeURIComponent(c.model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(c.key),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 900 },
      }),
    }
  }
  if (c.provider === 'anthropic') {
    return {
      url: (c.base || 'https://api.anthropic.com') + '/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.key,
        'anthropic-version': '2023-06-01',
        // Без этого браузеру к Anthropic ходить нельзя — заголовок и придуман
        // ровно для случая «ключ пользователя, запрос со страницы».
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: c.model, max_tokens: 800, stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    }
  }
  return {
    url: (c.base || 'https://api.openai.com') + '/v1/chat/completions',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
    body: JSON.stringify({
      model: c.model, stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  }
}

/**
 * Разбор потока. Оба сервиса шлют server-sent events: строки «data: {…}»,
 * разделённые пустой строкой, и «data: [DONE]» в конце.
 *
 * Разбор отдельной функцией и с состоянием: кусок из сети рвётся где угодно, в
 * том числе посреди слова «data» или посреди JSON. Наивный разбор «поделить
 * кусок по строкам» теряет такие обрывки — а выглядит это как пропавшие слова в
 * середине ответа, и поймать это глазами почти невозможно.
 */
export function makeSseReader(provider: AiProvider) {
  let buf = ''
  return function read(chunk: string): string[] {
    buf += chunk
    const out: string[] = []
    // Обрабатываем только ЗАВЕРШЁННЫЕ строки, хвост оставляем на следующий раз.
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let j: any
      try { j = JSON.parse(data) } catch { continue }
      const piece = provider === 'gemini'
        // У Google ответ приходит частями внутри candidates: собираем все куски
        // текста, а не только первый — иначе терялись бы половины предложений.
        ? (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
        : provider === 'anthropic'
        ? (j?.type === 'content_block_delta' ? j?.delta?.text : '')
        : j?.choices?.[0]?.delta?.content
      if (typeof piece === 'string' && piece) out.push(piece)
    }
    return out
  }
}

/** Понятная причина отказа вместо кода ошибки. */
export function whyFailed(status: number): string {
  if (status === 400) return 'Сервис не понял запрос — чаще всего это неверный ключ или название модели'
  if (status === 401 || status === 403) return 'Ключ не принят — проверь его в настройках'
  if (status === 404) return 'Такой модели у сервиса нет — проверь название модели'
  if (status === 429) return 'Сервис просит подождать: слишком часто или кончилась квота'
  if (status >= 500) return 'Сервис сейчас не отвечает — попробуй позже'
  return 'Сервис отказал (' + status + ')'
}

/**
 * Спросить. onChunk получает ответ по мере поступления.
 * Бросает с понятной причиной — её и показываем человеку.
 */
export async function askAi(c: AiConfig, prompt: string, onChunk: (s: string) => void, signal?: AbortSignal): Promise<void> {
  if (!aiReady(c)) throw new Error('Ключ не задан — открой Настройки → Активность')
  if (!prompt.trim()) throw new Error('Пустой вопрос')
  const { url, headers, body } = buildRequest(c, prompt)
  const res = await fetch(url, { method: 'POST', headers, body, signal })
  if (!res.ok) throw new Error(whyFailed(res.status))
  if (!res.body) {
    // Поток не дали — берём ответ целиком, чтобы не остаться совсем без ответа.
    onChunk(await res.text())
    return
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  const sse = makeSseReader(c.provider)
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    for (const piece of sse(dec.decode(value, { stream: true }))) onChunk(piece)
  }
}
