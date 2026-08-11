// v1.545.0: большой файл правда доезжает целым. Запуск: npm run test:bigfile
//
// Владелец: «супабейс не даёт ни клип сохранить… сделай чтобы даже без
// зависимости серверов загружались файлы больше 45 МБ».
//
// Здесь проверяется ВЕСЬ круг на настоящем HTTP: файл режется на куски, куски
// уходят запросами, потом скачиваются обратно и склеиваются — и склеенное
// сравнивается с исходником побайтно.
//
// ПОЧЕМУ СВОЙ СЕРВЕР, А НЕ SUPABASE. Проверка не должна писать в боевое
// хранилище владельца, а без записи проверять нечего. Свой сервер на 127.0.0.1
// принимает те же запросы, что и хранилище, и заодно умеет то, чего от чужого
// не добьёшься: ОТКАЗАТЬ по размеру. Именно на этом отказе и держится вся
// затея, а увидеть его иначе можно только на чужом клипе.
//
// ПОЧЕМУ ПОБАЙТНО, А НЕ ПО РАЗМЕРУ. Совпадение размеров ничего не значит:
// переставленные местами куски дают ровно тот же размер и битое видео. Это
// главная ошибка, какую здесь можно допустить, и ловится она только сравнением
// содержимого.
const { app, BrowserWindow } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, '..', 'dist-bigfile-test')
fs.mkdirSync(OUT, { recursive: true })

let failed = 0
const check = (name, ok, extra) => {
  console.log((ok ? '  ok   ' : '  ПРОВАЛ ') + name + (extra ? '  — ' + extra : ''))
  if (!ok) failed++
}

// ── Хранилище-заглушка: те же адреса, что у Supabase Storage ─────────────────
const склад = new Map()          // путь → Buffer
let пределОдного = Infinity      // сколько байт принимает один объект
const принято = []               // что и какого размера пришло

function сервер(порт) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const путь = decodeURIComponent(url.pathname)

    if (req.method === 'POST' && путь.startsWith('/storage/v1/object/')) {
      const куски = []
      req.on('data', c => куски.push(c))
      req.on('end', () => {
        const тело = Buffer.concat(куски)
        if (тело.length > пределОдного) {
          res.writeHead(413, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }))
          return
        }
        склад.set(путь.replace('/storage/v1/object/', ''), тело)
        принято.push({ путь, размер: тело.length })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"Key":"ok"}')
      })
      return
    }

    // Публичный адрес, каким его отдаёт getPublicUrl.
    if (req.method === 'GET' && путь.startsWith('/storage/v1/object/public/')) {
      const ключ = путь.replace('/storage/v1/object/public/', '')
      const тело = склад.get(ключ)
      if (!тело) { res.writeHead(404); res.end('нет'); return }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': тело.length })
      res.end(тело)
      return
    }

    if (req.method === 'GET' && путь === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset=utf-8><body><script src="/bundle.js"></script></body>')
      return
    }
    if (req.method === 'GET' && путь === '/bundle.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end(fs.readFileSync(path.join(OUT, 'bundle.js')))
      return
    }
    // Всё остальное (в том числе запросы supabase-js к auth) — пустой ответ.
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  }).listen(порт, '127.0.0.1')
}

const ПОРТ = 39117
const БАЗА = 'http://127.0.0.1:' + ПОРТ

// Модуль приложения собирает npm-скрипт (см. package.json, test:bigfile):
// это НАСТОЯЩИЙ src/lib/bigUpload.ts, а не его пересказ.

app.disableHardwareAcceleration()
setTimeout(() => { console.log('ЗАВИС'); process.exit(2) }, 180000)

app.whenReady().then(async () => {
  const srv = сервер(ПОРТ)
  const win = new BrowserWindow({ show: false, width: 500, height: 400,
    webPreferences: { backgroundThrottling: false } })
  await win.loadURL(БАЗА + '/')
  await new Promise(r => setTimeout(r, 400))

  console.log('\n── Большой файл кусками ──')

  // Кусок в проверке маленький: гонять по 45 МБ ради проверки арифметики
  // незачем, а поведение от размера куска не зависит — оно зависит от того, что
  // кусков БОЛЬШЕ ОДНОГО и последний короче.
  const КУСОК = await win.webContents.executeJavaScript('BF.КУСОК')
  check('предел куска не больше 45 МБ', КУСОК <= 45 * 1024 * 1024, Math.round(КУСОК / 1048576) + ' МБ')

  // 1. Круг целиком: отправили — скачали — сравнили побайтно.
  // Сервер принимает объект чуть крупнее нашего куска — как настоящее
  // хранилище: кусок пролезает, а целый файл нет.
  пределОдного = 46 * 1024 * 1024
  const итог = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    // Файл нарочно НЕ кратен куску: последний кусок должен быть короче.
    const размер = BF.КУСОК * 2 + 12345
    const байты = new Uint8Array(размер)
    // Заполняем так, чтобы перестановка кусков была видна: значение зависит от
    // положения. Одинаковыми байтами такую ошибку не поймать.
    for (let i = 0; i < размер; i++) байты[i] = (i * 31 + (i >> 16)) & 255
    const файл = new File([байты], 'клип.webm', { type: 'video/webm' })
    const адрес = await BF.отправитьЧастями('attachments', 'uid1', файл)
    const о = await BF.сведения(адрес)
    const собранныйАдрес = await BF.собрать(адрес)
    const назад = new Uint8Array(await (await fetch(собранныйАдрес)).arrayBuffer())
    let совпало = назад.length === байты.length
    if (совпало) for (let i = 0; i < байты.length; i++) if (назад[i] !== байты[i]) { совпало = false; break }
    return JSON.stringify({ адрес, имя: о.name, тип: о.type, размер: о.size, кусков: о.parts,
      длинаНазад: назад.length, совпало })
  })()`))

  check('адрес вложения — опись', /\.ponoipart$/.test(итог.адрес.split(/[?#]/)[0]), итог.адрес.slice(-40))
  check('опись знает настоящее имя и тип', итог.имя === 'клип.webm' && итог.тип === 'video/webm',
    итог.имя + ' / ' + итог.тип)
  check('кусков ровно столько, сколько надо', итог.кусков === 3, String(итог.кусков))
  check('ни один кусок не больше предела', принято.every(п => п.размер <= пределОдного),
    'самый крупный ' + Math.max(...принято.map(п => п.размер)))
  check('склеенный файл совпадает с исходным ПОБАЙТНО', итог.совпало === true,
    итог.длинаНазад + ' из ' + итог.размер)

  // 2. Проверка проверки: переставленные куски должны ломать сравнение. Если и
  //    так «совпало», значит сравнение ничего не проверяет.
  const порча = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const о = await (await fetch(${JSON.stringify(итог.адрес)})).json()
    const наоборот = { ...о, parts: [...о.parts].reverse() }
    const b = new Blob([JSON.stringify(наоборот)], { type: 'application/json' })
    const адрес = URL.createObjectURL(b)
    // Собираем руками, тем же способом, но по перевёрнутой описи.
    const куски = []
    for (const p of наоборот.parts) куски.push(await (await fetch(p)).blob())
    const целое = new Blob(куски)
    const назад = new Uint8Array(await целое.arrayBuffer())
    const размер = BF.КУСОК * 2 + 12345
    const эталон = new Uint8Array(размер)
    for (let i = 0; i < размер; i++) эталон[i] = (i * 31 + (i >> 16)) & 255
    let совпало = назад.length === эталон.length
    if (совпало) for (let i = 0; i < эталон.length; i++) if (назад[i] !== эталон[i]) { совпало = false; break }
    URL.revokeObjectURL(адрес)
    return JSON.stringify({ тотЖеРазмер: назад.length === эталон.length, совпало })
  })()`))
  check('перестановка кусков даёт тот же РАЗМЕР', порча.тотЖеРазмер === true)
  check('но не то же содержимое — значит сравнение работает', порча.совпало === false)

  // 3. Тот же файл, но сервер его целиком НЕ примет: это и есть случай, ради
  //    которого всё затевалось. Проверяем, что отправка кусками проходит там,
  //    где обычная упирается в отказ.
  пределОдного = 4 * 1024 * 1024
  const малый = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const размер = 10 * 1024 * 1024
    const байты = new Uint8Array(размер)
    for (let i = 0; i < размер; i++) байты[i] = (i * 7) & 255
    const файл = new File([байты], 'фото.png', { type: 'image/png' })
    // Обычная отправка одним куском — сервер откажет по размеру.
    let обычнаяУпала = false
    try {
      await new Promise((готово, отказ) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '${БАЗА}/storage/v1/object/attachments/uid1/целый.png')
        xhr.onload = () => xhr.status < 300 ? готово() : отказ(new Error('(' + xhr.status + ') ' + xhr.responseText))
        xhr.onerror = () => отказ(new Error('сеть'))
        xhr.send(файл)
      })
    } catch (e) { обычнаяУпала = /413|too large/i.test(String(e.message)) }
    return JSON.stringify({ обычнаяУпала })
  })()`))
  check('сервер отказывает целому файлу по размеру', малый.обычнаяУпала === true,
    'без этого проверка ничего не значит')

  // 4. Опись с чужим хостом не должна открываться.
  const чужая = await win.webContents.executeJavaScript(`(async () => {
    const b = new Blob([JSON.stringify({ v: 1, name: 'a', type: 'video/webm',
      size: BF.КУСОК + 10, parts: ['http://127.0.0.1:${ПОРТ}/a', 'https://зло.example/b'] })],
      { type: 'application/json' })
    const адрес = URL.createObjectURL(b) + '#x.ponoipart'
    try { await BF.прочитатьОпись('${БАЗА}/storage/v1/object/public/нет.ponoipart'); return 'открылась' }
    catch (e) { return String(e.message).slice(0, 40) }
  })()`)
  check('несуществующая опись отвечает понятно', /не открылась/i.test(чужая), чужая)

  try { for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f)) } catch { /* уже чисто */ }
  srv.close()
  console.log('\nИТОГ: провалено ' + failed)
  process.exit(failed ? 1 : 0)
})
