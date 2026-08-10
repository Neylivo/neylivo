// v1.529.0: заглянуть внутрь архива, не скачивая его.
//
// Владелец просил, чтобы у файла было видно «название, содержание и так далее».
// У архива содержание — это список того, что внутри. Узнать его можно, не
// качая сорок мегабайт: zip хранит опись В КОНЦЕ файла, и хватает последних
// нескольких десятков килобайт.
//
// Как устроен zip, и почему читается именно хвост:
//   • в самом конце лежит запись EOCD с подписью PK\5\6 — в ней сказано,
//     сколько внутри файлов и где начинается опись;
//   • опись (central directory) — это записи PK\1\2 подряд, у каждой имя,
//     размер сжатый и настоящий;
//   • сами данные лежат в начале, и они нам не нужны.
//
// Поэтому берётся хвост (обычный запрос с заголовком Range), и по нему
// собирается список. Если сервер не умеет отдавать кусок — честно говорим, что
// заглянуть не вышло, и не выдумываем содержимое.
//
// Разбор отделён от сети нарочно: его можно проверить на настоящих байтах без
// всякого сервера (npm run test:ui).

export interface ZipEntry {
  name: string
  /** Настоящий размер, байт. */
  size: number
  /** Папка (имя оканчивается косой чертой). */
  dir: boolean
}

export interface ZipPeek {
  entries: ZipEntry[]
  /** Сколько всего записей по описи — может быть больше, чем прочитано. */
  total: number
  /** Опись в прочитанный хвост поместилась целиком. */
  full: boolean
}

const EOCD = 0x06054b50
const CEN = 0x02014b50

function u16(b: Uint8Array, i: number): number { return b[i] | (b[i + 1] << 8) }
function u32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
}

/**
 * Разобрать хвост zip-файла.
 *
 * @param tail  последние байты файла
 * @param tailStart смещение этого куска от начала файла
 * @returns null — это не zip или опись в хвост не попала
 */
export function parseZipTail(tail: Uint8Array, tailStart = 0): ZipPeek | null {
  if (!tail || tail.length < 22) return null

  // EOCD ищем с конца: в ней может быть комментарий, поэтому она не обязана
  // быть последними 22 байтами.
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tail, i) === EOCD) { eocd = i; break }
  }
  if (eocd < 0) return null

  const total = u16(tail, eocd + 10)
  const cenSize = u32(tail, eocd + 12)
  const cenOff = u32(tail, eocd + 16)

  // Где опись внутри нашего куска. Отрицательное — значит хвоста не хватило.
  const начало = cenOff - tailStart
  const целиком = начало >= 0 && начало + cenSize <= tail.length
  let i = целиком ? начало : 0
  // Не поместилась — начинаем с первой попавшейся записи описи в куске.
  if (!целиком) {
    i = -1
    for (let j = 0; j + 4 <= tail.length; j++) {
      if (u32(tail, j) === CEN) { i = j; break }
    }
    if (i < 0) return { entries: [], total, full: false }
  }

  const entries: ZipEntry[] = []
  const dec = new TextDecoder('utf-8', { fatal: false })
  while (i + 46 <= tail.length && u32(tail, i) === CEN) {
    const nameLen = u16(tail, i + 28)
    const extraLen = u16(tail, i + 30)
    const cmtLen = u16(tail, i + 32)
    const size = u32(tail, i + 24)
    const конецИмени = i + 46 + nameLen
    if (конецИмени > tail.length) break
    const name = dec.decode(tail.subarray(i + 46, конецИмени))
    entries.push({ name, size, dir: name.endsWith('/') })
    i = конецИмени + extraLen + cmtLen
  }
  return { entries, total, full: целиком && entries.length === total }
}

/** Сколько хвоста просить. Опись у обычного архива в это укладывается. */
export const ZIP_TAIL = 128 * 1024

/**
 * Заглянуть в архив по ссылке. null — сервер не дал кусок или это не zip.
 *
 * Ничего не кэшируем и не качаем целиком: один запрос на сто килобайт.
 */
export async function peekZip(url: string, size?: number | null): Promise<ZipPeek | null> {
  try {
    const всего = Number(size) || 0
    const от = всего > ZIP_TAIL ? всего - ZIP_TAIL : 0
    const r = await fetch(url, { headers: { Range: 'bytes=' + от + '-' } })
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    // Сервер мог не понять Range и прислать файл целиком — тогда смещение нулевое.
    const целый = r.status !== 206
    return parseZipTail(buf, целый ? 0 : от)
  } catch { return null }
}
