import { supabase } from './supabase'
import { runUploadHooks } from './plugins/bridge'
import { contentTypeOf } from './fileType'
import { надоРезать, отказПоРазмеру } from './bigFile'
import { отправитьЧастями } from './bigUpload'
import { КЭШ_НАВСЕГДА } from './cacheHeader'
export { contentTypeOf } from './fileType'


/**
 * Перехватчики вложений (v1.475.0).
 *
 * Единственная точка: обе загрузки (обычная и с прогрессом) идут через неё, и
 * все четыре экрана, которые отправляют файлы, — тоже. Раскидай мы это по
 * вызывающим, один из них однажды забыли бы, и плагин, снимающий геометку с
 * фотографий, молча не работал бы в личных сообщениях.
 *
 * У человека без плагинов здесь ничего не происходит: прослойка отвечает сразу,
 * не загружая систему плагинов (bridge.ts).
 */
export class UploadCancelled extends Error {
  constructor(public by: string | null) {
    super('Отправку файла отменил плагин')
  }
}

async function черезПлагины(file: File): Promise<File> {
  const r = await runUploadHooks(file)
  // Отмена обязана быть ЗАМЕТНОЙ. Молча не отправить файл, который человек
  // только что выбрал, — худшее из возможного: он решит, что сломано
  // приложение, и не свяжет это с плагином.
  if (r.cancel) throw new UploadCancelled(r.by)
  return r.file
}

// Uploads a file into <bucket>/<uid>/<timestamp>_<name> and returns its public URL.
export async function uploadTo(bucket: string, uid: string, fileRaw: File): Promise<string> {
  const file = await черезПлагины(fileRaw)
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${uid}/${Date.now()}_${safe}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: КЭШ_НАВСЕГДА, upsert: false, contentType: contentTypeOf(file),
  })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

// v1.384.0: у файла из буфера обмена типа может не быть — тогда смотрим на имя.
// Без этого вставленный скриншот считался не картинкой и уходил как вложение-файл.
export const isImage = (f: File | string) =>
  typeof f === 'string' ? /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(f)
    : contentTypeOf(f).startsWith('image/')

export const isVideo = (f: File | string) =>
  typeof f === 'string' ? /\.(mp4|webm|mov|m4v|mkv|avi)(\?|#|$)/i.test(f)
    : contentTypeOf(f).startsWith('video/')


// Загрузка с прогрессом: XMLHttpRequest даёт события progress, которых нет в supabase-js.
// Заголовки и путь те же, что использует supabase.storage.upload, поэтому политики бакета работают как раньше.
export async function uploadWithProgress(bucket: string, uid: string, fileRaw: File, onProgress?: (p: number) => void): Promise<string> {
  const file = await черезПлагины(fileRaw)
  // v1.545.0: большой файл уходит кусками.
  //
  // Хранилище принимает один объект ограниченного размера — полсотни мегабайт
  // на бесплатном тарифе. Приложение при этом разрешало сорок гигабайт: человек
  // выбирал клип на сто мегабайт, дожидался конца загрузки и получал отказ.
  // Теперь такой файл режется на куски по 45 МБ, и в хранилище не появляется ни
  // одного объекта, который ему велик.
  if (надоРезать(file.size)) return await отправитьЧастями(bucket, uid, file, onProgress)
  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const path = `${uid}/${Date.now()}_${safe}`
  const base = import.meta.env.VITE_SUPABASE_URL as string
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token ?? anon
  // Предел на файл у каждого проекта свой, и узнать его заранее неоткуда.
  // Поэтому обычная отправка, упавшая ИМЕННО на размере, переходит на куски —
  // человек об этом даже не узнает. Отказ по правам или сети сюда не попадает:
  // кусками он не лечится, и молча повторять его тридцать раз было бы хуже.
  try {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.setRequestHeader('apikey', anon)
    xhr.setRequestHeader('cache-control', 'max-age=' + КЭШ_НАВСЕГДА)
    xhr.setRequestHeader('content-type', contentTypeOf(file))
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      if (xhr.status < 300) return resolve()
      // Текст ответа нужен целиком: по нему отличается «файл велик» от «нет
      // прав». Первое лечится кусками, второе — нет.
      reject(new Error('Загрузка не удалась (' + xhr.status + ') ' + String(xhr.responseText || '').slice(0, 200)))
    }
    xhr.onerror = () => reject(new Error('Сбой сети при загрузке файла'))
    xhr.send(file)
  })
  } catch (e) {
    if (!отказПоРазмеру(e)) throw e
    return await отправитьЧастями(bucket, uid, file, onProgress)
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
