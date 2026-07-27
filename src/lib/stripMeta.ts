// v1.305.0: снятие метаданных с отправляемых изображений.
//
// Снимок с телефона несёт в себе куда больше, чем картинку: координаты места
// съёмки (а это обычно дом), модель аппарата, точное время, иногда имя владельца.
// До сих пор всё это уезжало вместе с фотографией — и на сервер, и получателю.
// Для приложения, которое старается ничего о человеке не выдавать, это была самая
// прямая утечка из возможных: она выдаёт не «с кем переписывался», а буквально
// адрес.
//
// Способ простой и надёжный: перерисовать изображение на холст и закодировать
// заново. Метаданных при этом не остаётся вообще никаких — не «мы вычистили
// известные поля», а «в новом файле их просто нет».

/** Форматы, которые можно безопасно перекодировать. */
const RASTER = ['image/jpeg', 'image/png', 'image/webp']

/** Качество перекодирования. 0.92 — на глаз неотличимо от исходника,
 *  при этом файл обычно не растёт. */
const QUALITY = 0.92

export function needsStrip(file: File): boolean {
  // GIF пропускаем сознательно: перекодирование через холст оставило бы от
  // анимации один кадр. SVG — не растр, и метаданных в привычном смысле не несёт.
  return RASTER.includes(file.type)
}

/**
 * Вернуть копию изображения без метаданных. Если перекодировать не удалось
 * (повреждённый файл, слишком большой для холста), возвращает null — вызывающая
 * сторона решает, отправлять ли исходник, и обязана предупредить человека.
 */
export async function stripImageMetadata(file: File): Promise<File | null> {
  if (!needsStrip(file)) return null
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    // PNG оставляем PNG: у него бывает прозрачность, а перевод в JPEG залил бы её чёрным.
    const type = file.type === 'image/png' ? 'image/png' : file.type
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, type, QUALITY))
    if (!blob) return null
    return new File([blob], file.name, { type, lastModified: Date.now() })
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}

/**
 * Очистить набор файлов перед отправкой. Возвращает очищенные файлы и список имён
 * тех, с которыми не вышло, — чтобы человеку можно было честно сказать, что по ним
 * метаданные остались, а не молча их отправить.
 */
export async function stripAll(files: File[]): Promise<{ files: File[]; failed: string[] }> {
  const out: File[] = []
  const failed: string[] = []
  for (const f of files) {
    if (!needsStrip(f)) { out.push(f); continue }
    const cleaned = await stripImageMetadata(f)
    if (cleaned) out.push(cleaned)
    else { out.push(f); failed.push(f.name) }
  }
  return { files: out, failed }
}
