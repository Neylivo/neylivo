// v1.436.0: кто заглушён — видно всем, как в Discord.
//
// Что было. «Заглушить всех» (наушники) выключает звук у себя и заодно свой
// микрофон. Микрофон собеседники видят — его состояние знает сам сервер связи. А
// вот то, что человек НИЧЕГО НЕ СЛЫШИТ, не знал никто: со стороны он выглядел
// как обычный участник с выключенным микрофоном. В Discord это разные значки, и
// разница важная — с заглушившим бесполезно разговаривать.
//
// Как теперь. Состояние рассылается сообщениями самого звонка (data-канал
// LiveKit): ничего не надо ни от сервера, ни от токена, и приходит оно всем, кто
// в комнате. Разбор и склейка — здесь, чистыми функциями: в самом звонке их
// проверить нечем (нужны два человека), а тут можно.

/** Что человек сообщает о себе остальным в звонке. */
export interface CallFlags {
  /** Заглушил всех: не слышит никого. */
  deaf: boolean
  /** Микрофон включён. Дублирует сервер связи, но приходит одним пакетом. */
  mic: boolean
}

const TAG = 'ponoi-call-flags'

/** Упаковать для отправки. Версия — чтобы старые клиенты не путались. */
export function encodeFlags(f: CallFlags): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ t: TAG, v: 1, deaf: !!f.deaf, mic: !!f.mic }))
}

/**
 * Разобрать входящее. Чужое и битое — молча мимо: по этому же каналу ходят
 * сообщения саундпада и всего остального, что появится позже.
 */
export function decodeFlags(data: Uint8Array | ArrayBuffer | null | undefined): CallFlags | null {
  if (!data) return null
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    const o = JSON.parse(new TextDecoder().decode(bytes))
    if (!o || o.t !== TAG) return null
    return { deaf: !!o.deaf, mic: o.mic !== false }
  } catch { return null }
}

/**
 * Обновить общую таблицу состояний.
 *
 * Возвращает НОВЫЙ объект, только если что-то изменилось: перерисовывать звонок
 * на каждое одинаковое сообщение (а они приходят и при каждом чужом входе)
 * значит дёргать все плитки без причины.
 */
export function mergeFlags(
  map: Record<string, CallFlags>, identity: string, f: CallFlags | null,
): Record<string, CallFlags> {
  if (!identity || !f) return map
  const cur = map[identity]
  if (cur && cur.deaf === f.deaf && cur.mic === f.mic) return map
  return { ...map, [identity]: f }
}

/** Забыть вышедшего: иначе его значок останется висеть на пустом месте. */
export function forgetFlags(map: Record<string, CallFlags>, identity: string): Record<string, CallFlags> {
  if (!identity || !(identity in map)) return map
  const next = { ...map }
  delete next[identity]
  return next
}

/**
 * Что показать на плитке: наушники перечёркнуты важнее перечёркнутого микрофона.
 *
 * Заглушивший всех почти всегда и без микрофона (мы его выключаем сами), и два
 * значка сразу на маленькой плитке — это шум. Discord показывает один, самый
 * важный: «он тебя не слышит».
 */
export type TileIcon = 'deaf' | 'muted' | 'none'
export function tileIcon(f: CallFlags | undefined, micFromServer: boolean): TileIcon {
  if (f?.deaf) return 'deaf'
  if (!micFromServer || (f && !f.mic)) return 'muted'
  return 'none'
}
