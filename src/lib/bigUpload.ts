import { supabase } from './supabase'
import { contentTypeOf } from './fileType'
import { подписать } from './attachUrl'
import { КЭШ_НАВСЕГДА } from './cacheHeader'
import {
  КУСОК, РАСШИРЕНИЕ, надоРезать, сколькоКусков, границы, имяКуска,
  опись, годнаяОпись, этоОпись, type BigManifest,
} from './bigFile'

// v1.545.0: отправка большого файла кусками и сборка его обратно.
//
// Чистая часть (сколько кусков, как выглядит опись, что считать негодным) — в
// bigFile.ts, она проверяется числами. Здесь то, что без сети не проверишь.
//
// ПОЧЕМУ КУСКИ — ОБЫЧНЫЕ ОБЪЕКТЫ, А НЕ «МНОГОЧАСТНАЯ ЗАГРУЗКА» ХРАНИЛИЩА.
// Многочастная у хранилища есть, но её предел на итоговый файл — тот же самый.
// Здесь же в хранилище не появляется ни одного объекта крупнее куска, поэтому
// предел на файл перестаёт что-либо значить, и работает это на любом тарифе,
// без единой настройки на сервере.

/** Куда уходит один кусок. */
async function отправитьКусок(
  bucket: string, path: string, кусок: Blob, token: string, base: string, anon: string,
  наПрогресс?: (доля: number) => void,
): Promise<void> {
  await new Promise<void>((готово, отказ) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${base}/storage/v1/object/${bucket}/${path}`)
    xhr.setRequestHeader('Authorization', 'Bearer ' + token)
    xhr.setRequestHeader('apikey', anon)
    // Кусок неизменяем ровно так же, как обычный файл: его адрес содержит время
    // отправки. Час, стоявший здесь раньше, заставлял перекачивать клип целиком
    // при каждом повторном просмотре — см. КЭШ_НАВСЕГДА в storage.ts.
    xhr.setRequestHeader('cache-control', 'max-age=' + КЭШ_НАВСЕГДА)
    // Тип у куска обезличенный намеренно: сам по себе кусок — не видео и не
    // картинка, а настоящий тип записан в описи.
    xhr.setRequestHeader('content-type', 'application/octet-stream')
    xhr.upload.onprogress = e => { if (e.lengthComputable && наПрогресс) наПрогресс(e.loaded / e.total) }
    xhr.onload = () => {
      if (xhr.status < 300) готово()
      else отказ(new Error('Кусок не принят (' + xhr.status + ') ' + String(xhr.responseText || '').slice(0, 160)))
    }
    xhr.onerror = () => отказ(new Error('Сбой сети при отправке куска'))
    xhr.send(кусок)
  })
}

/**
 * Отправить файл кусками. Возвращает адрес ОПИСИ — её и показывает приложение.
 *
 * Прогресс считается по всему файлу целиком, а не по текущему куску: человеку
 * важно, сколько осталось до конца, а не до конца двенадцатого куска из
 * тридцати.
 */
export async function отправитьЧастями(
  bucket: string, uid: string, file: File, наПрогресс?: (p: number) => void,
): Promise<string> {
  const base = import.meta.env.VITE_SUPABASE_URL as string
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  const { data: s } = await supabase.auth.getSession()
  const token = s.session?.access_token ?? anon

  const safe = file.name.replace(/[^\w.\-]+/g, '_')
  const корень = `${uid}/${Date.now()}_${safe}`
  const всего = сколькоКусков(file.size)
  const адреса: string[] = []

  for (let n = 0; n < всего; n++) {
    const { от, до } = границы(file.size, n)
    const путь = `${корень}/${имяКуска(n)}`
    await отправитьКусок(bucket, путь, file.slice(от, до), token, base, anon, доля => {
      if (наПрогресс) наПрогресс((n + доля) / всего)
    })
    адреса.push(supabase.storage.from(bucket).getPublicUrl(путь).data.publicUrl)
  }

  // Опись кладём ПОСЛЕДНЕЙ. Появилась опись — значит все куски уже на месте;
  // упали на середине — в хранилище остались куски, но приложение о них не
  // знает и битого файла никому не покажет.
  const тело = new Blob([JSON.stringify(опись(file.name, contentTypeOf(file), file.size, адреса))],
    { type: 'application/json' })
  const путьОписи = корень + РАСШИРЕНИЕ
  await отправитьКусок(bucket, путьОписи, тело, token, base, anon)
  if (наПрогресс) наПрогресс(1)
  return supabase.storage.from(bucket).getPublicUrl(путьОписи).data.publicUrl
}

/** Что нужно знать про большой файл, не скачивая его. */
export interface BigInfo { name: string; type: string; size: number; parts: number }

const описиВПамяти = new Map<string, BigManifest>()

/** Прочитать опись. Сам файл при этом не качается — только несколько сотен байт. */
export async function прочитатьОпись(url: string): Promise<BigManifest> {
  const есть = описиВПамяти.get(url)
  if (есть) return есть
  // v1.557.0 (находка F1): и опись, и куски берём по подписанной ссылке —
  // иначе после закрытия бакета большой файл перестал бы собираться, а причина
  // выглядела бы как «опись повреждена».
  const r = await fetch(await подписать(url))
  if (!r.ok) throw new Error('Опись не открылась (' + r.status + ')')
  const данные = await r.json()
  // Хост берём у самой описи: куски обязаны лежать там же, где она.
  const хост = new URL(url).host
  if (!годнаяОпись(данные, хост)) throw new Error('Опись повреждена')
  описиВПамяти.set(url, данные)
  return данные
}

export async function сведения(url: string): Promise<BigInfo> {
  const о = await прочитатьОпись(url)
  return { name: о.name, type: о.type, size: о.size, parts: о.parts.length }
}

const собранное = new Map<string, string>()

/**
 * Скачать куски и склеить обратно. Возвращает адрес готового файла в памяти.
 *
 * Куски идут ПО ОДНОМУ и строго по порядку. Качать их разом было бы быстрее, но
 * тогда в памяти оказывается весь файл сразу двумя копиями — кусками и
 * склеенный; на клипе в двести мегабайт это ровно та беда, из-за которой всё и
 * затевалось.
 */
export async function собрать(url: string, наПрогресс?: (p: number) => void): Promise<string> {
  const готовое = собранное.get(url)
  if (готовое) return готовое
  const о = await прочитатьОпись(url)
  const куски: Blob[] = []
  for (let i = 0; i < о.parts.length; i++) {
    const r = await fetch(await подписать(о.parts[i]))
    if (!r.ok) throw new Error('Кусок ' + (i + 1) + ' не скачался (' + r.status + ')')
    куски.push(await r.blob())
    if (наПрогресс) наПрогресс((i + 1) / о.parts.length)
  }
  const целое = new Blob(куски, { type: о.type || 'application/octet-stream' })
  // Сверяем размер: склеенный файл обязан совпасть с обещанным в описи. Не
  // сойдётся — значит кусок недокачался, и лучше сказать это прямо, чем отдать
  // человеку битое видео.
  if (целое.size !== о.size) {
    throw new Error('Файл собрался не полностью: ' + целое.size + ' из ' + о.size)
  }
  const адрес = URL.createObjectURL(целое)
  собранное.set(url, адрес)
  return адрес
}

/** Скачать большой файл на диск под настоящим именем. */
export async function скачатьБольшой(url: string, наПрогресс?: (p: number) => void): Promise<void> {
  const о = await прочитатьОпись(url)
  const адрес = await собрать(url, наПрогресс)
  const a = document.createElement('a')
  a.href = адрес
  a.download = о.name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export { этоОпись, КУСОК, надоРезать }
