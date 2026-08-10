// v1.529.0: что за файл прислали — по имени, без гаданий.
//
// Владелец: «сделай кнопку скачать файл удобной, чтобы можно было посмотреть
// название, содержание и так далее».
//
// Что было. Картинки показывались картинками, текст и код — карточкой с
// превью (CodeFileCard). Всё остальное — архив, установщик, видео, документ,
// что угодно — одной синей строкой «Скачать файл 47.8 МБ». Ни имени, ни типа,
// ни намёка на содержимое: человек не знал, что скачивает, пока не скачает.
//
// Здесь только РАЗБОР ИМЕНИ: вид файла, значок и человеческое название типа.
// Отдельно от разметки — потому что это правило, и его надо проверять числами,
// а не глазами (npm run test:ui).

export type FileKind =
  | 'archive' | 'video' | 'audio' | 'image' | 'doc' | 'sheet' | 'slides'
  | 'pdf' | 'code' | 'exe' | 'font' | 'other'

interface Вид {
  kind: FileKind
  /** Имя значка из нашего набора (src/components/icons.tsx). */
  icon: string
  /** Как назвать тип человеку. */
  label: string
}

const ПО_РАСШИРЕНИЮ: Record<string, Вид> = {}
const добавить = (расширения: string, вид: Вид) => {
  for (const р of расширения.split(' ')) ПО_РАСШИРЕНИЮ[р] = вид
}

добавить('zip rar 7z tar gz bz2 xz zst tgz', { kind: 'archive', icon: 'folder', label: 'Архив' })
добавить('mp4 mkv mov avi webm m4v', { kind: 'video', icon: 'video', label: 'Видео' })
добавить('mp3 wav flac ogg m4a aac opus', { kind: 'audio', icon: 'music', label: 'Аудио' })
добавить('png jpg jpeg gif webp bmp avif heic', { kind: 'image', icon: 'image', label: 'Изображение' })
добавить('doc docx odt rtf', { kind: 'doc', icon: 'file', label: 'Документ' })
добавить('xls xlsx ods csv', { kind: 'sheet', icon: 'list', label: 'Таблица' })
добавить('ppt pptx odp', { kind: 'slides', icon: 'image', label: 'Презентация' })
добавить('pdf', { kind: 'pdf', icon: 'file', label: 'PDF' })
добавить('exe msi apk dmg deb rpm appimage', { kind: 'exe', icon: 'download', label: 'Установщик' })
добавить('ttf otf woff woff2', { kind: 'font', icon: 'edit', label: 'Шрифт' })
добавить('js mjs cjs ts tsx jsx py rs go java kt cs c h cpp css html json yml yaml sh bat ps1 sql md txt log',
  { kind: 'code', icon: 'code', label: 'Текст' })

const НЕИЗВЕСТНО: Вид = { kind: 'other', icon: 'paperclip', label: 'Файл' }

/** Имя файла из ссылки: без пути, без запроса, раскодированное. */
export function fileNameOf(url: string, override?: string | null): string {
  if (override && override.trim()) return override.trim()
  const хвост = String(url || '').split('/').pop() ?? ''
  const без = хвост.split('?')[0].split('#')[0]
  try { return decodeURIComponent(без) || 'файл' } catch { return без || 'файл' }
}

/** Расширение в нижнем регистре, без точки. */
export function extOf(name: string): string {
  const т = name.lastIndexOf('.')
  return т > 0 ? name.slice(т + 1).toLowerCase() : ''
}

/** Вид файла по имени. Неизвестное — честно «Файл», а не выдуманный тип. */
export function fileKind(name: string): Вид {
  return ПО_РАСШИРЕНИЮ[extOf(name)] ?? НЕИЗВЕСТНО
}

/**
 * Размер по-человечески. Ноль и отрицательное — пусто: писать «0 Б» у файла,
 * размер которого мы не узнали, значит соврать.
 */
export function sizeText(bytes: number | null | undefined): string {
  const b = Number(bytes)
  if (!isFinite(b) || b <= 0) return ''
  if (b < 1024) return b + ' Б'
  if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10 * 1024 ? 1 : 0).replace('.', ',') + ' КБ'
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',') + ' МБ'
  return (b / 1024 / 1024 / 1024).toFixed(1).replace('.', ',') + ' ГБ'
}

/**
 * Подпись под именем: тип и размер. Разделитель ставится, только если есть
 * обе части — иначе в карточке повисает одинокая точка.
 */
export function fileSub(name: string, bytes?: number | null): string {
  const т = fileKind(name).label
  const р = sizeText(bytes)
  return р ? т + ' · ' + р : т
}
