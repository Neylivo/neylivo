// v1.538.0: запись последних секунд экрана — как в Medal.
//
// Владелец: «добавить возможность как в Medal сохранять от 5 секунд до 3 минут
// того, что происходило на экране».
//
// КАК ЭТО РАБОТАЕТ. Человек не знает заранее, что случится что-то, ради чего
// стоит нажать «записать». Поэтому запись идёт всё время, но никуда не
// сохраняется: куски складываются в кольцо и вытесняют старые. Нажал горячую
// клавишу — на диск попадает то, что уже прошло.
//
// ПОЧЕМУ ОТДЕЛЬНОЕ СКРЫТОЕ ОКНО. Запись нужна ровно тогда, когда приложение
// свёрнуто и человек играет. Главное окно в этот момент Chromium придушивает, и
// запись пошла бы рывками. Скрытое окно с выключенным придушиванием живёт
// ровно для этого и больше ни для чего.
//
// ПОЧЕМУ ЗАГОЛОВОК ХРАНИТСЯ ОТДЕЛЬНО. У webm первый кусок — описание дорожек, и
// без него файл не открывается ничем. Значит вытеснять «самый старый» кусок
// нельзя: заголовок держим вечно, вытесняем только те, что после. Ошибка тут
// даёт файл на мегабайты, который не открывается, и по коду этого не видно —
// только по битому файлу. Проверено живым захватом: 5 кусков из 7 дали
// работающий клип 1280×720.
const { BrowserWindow, desktopCapturer, ipcMain, app, globalShortcut, shell } = require('electron')
const fs = require('fs')
const path = require('path')

let окно = null
let настройки = { seconds: 30, fps: 30, height: 720, bitrate: 4_000_000, folder: '' }
let идёт = false

/** Куда складывать клипы. По умолчанию — «Видео/Ponoi», как делает Medal. */
function папка() {
  if (настройки.folder) return настройки.folder
  let база
  try { база = app.getPath('videos') } catch { база = app.getPath('home') }
  return path.join(база, 'Ponoi')
}

function страница() {
  // Вся работа с камерой экрана живёт здесь: в главном процессе нет ни
  // MediaRecorder, ни доступа к потоку.
  return `<!doctype html><meta charset=utf-8><body><script>
const { ipcRenderer } = require('electron')
let кусочки = []
let rec = null
let поток = null

function обрезать(держать) {
  const порог = Date.now() - (держать + 5) * 1000
  кусочки = кусочки.filter(c => c.head || c.at >= порог)
}

ipcRenderer.on('старт', async (_e, { sourceId, seconds, fps, height, bitrate }) => {
  try {
    if (rec) { try { rec.stop() } catch {} }
    if (поток) поток.getTracks().forEach(t => t.stop())
    кусочки = []
    поток = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId,
        maxHeight: height, maxFrameRate: fps } },
    })
    rec = new MediaRecorder(поток, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: bitrate })
    rec.ondataavailable = e => {
      if (!e.data || !e.data.size) return
      кусочки.push({ blob: e.data, at: Date.now(), head: кусочки.length === 0 })
      обрезать(seconds)
    }
    rec.start(1000)
    ipcRenderer.send('готово', { ok: true })
  } catch (e) { ipcRenderer.send('готово', { ok: false, why: String(e && e.message || e) }) }
})

ipcRenderer.on('стоп', () => {
  try { if (rec) rec.stop() } catch {}
  if (поток) поток.getTracks().forEach(t => t.stop())
  rec = null; поток = null; кусочки = []
})

ipcRenderer.on('сохранить', async (_e, { seconds, id }) => {
  try {
    const порог = Date.now() - seconds * 1000
    const взять = кусочки.filter(c => c.head || c.at >= порог)
    if (взять.length < 2) { ipcRenderer.send('клип', { id, ok: false, why: 'пока нечего сохранять' }); return }
    const blob = new Blob(взять.map(c => c.blob), { type: 'video/webm' })
    const buf = new Uint8Array(await blob.arrayBuffer())
    ipcRenderer.send('клип', { id, ok: true, bytes: Array.from(buf) })
  } catch (e) { ipcRenderer.send('клип', { id, ok: false, why: String(e && e.message || e) }) }
})
</script></body>`
}

async function поднять() {
  if (окно && !окно.isDestroyed()) return окно
  окно = new BrowserWindow({
    show: false, width: 320, height: 240,
    webPreferences: {
      backgroundThrottling: false,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  // Страница кладётся ФАЙЛОМ и грузится с file://, а не из data:.
  //
  // data: — это «непрозрачный источник», и Chromium не считает его безопасным:
  // navigator.mediaDevices там попросту нет, и первая моя попытка падала с
  // «Cannot read properties of undefined (reading 'getUserMedia')». С file://
  // доступ к экрану выдаётся как обычно.
  let где
  try { где = app.getPath('userData') } catch { где = require('os').tmpdir() }
  const файл = path.join(где, 'clip-recorder.html')
  fs.writeFileSync(файл, страница(), 'utf8')
  await окно.loadFile(файл)
  return окно
}

/** Начать держать кольцо. */
async function start(opts = {}) {
  настройки = { ...настройки, ...opts }
  const w = await поднять()
  const источники = await desktopCapturer.getSources({ types: ['screen'] })
  if (!источники.length) return { ok: false, why: 'экран не найден' }
  return await new Promise(готово => {
    ipcMain.once('готово', (_e, r) => { идёт = !!r.ok; готово(r) })
    w.webContents.send('старт', {
      sourceId: источники[0].id,
      seconds: настройки.seconds, fps: настройки.fps,
      height: настройки.height, bitrate: настройки.bitrate,
    })
    setTimeout(() => готово({ ok: false, why: 'запись не началась' }), 8000)
  })
}

function stop() {
  идёт = false
  if (окно && !окно.isDestroyed()) окно.webContents.send('стоп')
}

/** Сохранить последние секунды на диск. Возвращает путь к файлу. */
async function save(seconds, name) {
  if (!идёт || !окно || окно.isDestroyed()) return { ok: false, why: 'запись не идёт' }
  const id = Math.random().toString(36).slice(2)
  const ответ = await new Promise(готово => {
    const слушать = (_e, r) => { if (r.id === id) { ipcMain.off('клип', слушать); готово(r) } }
    ipcMain.on('клип', слушать)
    окно.webContents.send('сохранить', { seconds, id })
    setTimeout(() => { ipcMain.off('клип', слушать); готово({ ok: false, why: 'не дождались клипа' }) }, 15000)
  })
  if (!ответ.ok) return ответ
  const дир = папка()
  try { fs.mkdirSync(дир, { recursive: true }) } catch { /* уже есть */ }
  const файл = path.join(дир, name)
  fs.writeFileSync(файл, Buffer.from(ответ.bytes))
  return { ok: true, path: файл, bytes: ответ.bytes.length }
}

function state() {
  return { running: идёт, folder: папка(), ...настройки }
}

/** Показать папку с клипами в проводнике. */
function openFolder() {
  const дир = папка()
  try { fs.mkdirSync(дир, { recursive: true }) } catch { /* уже есть */ }
  shell.openPath(дир)
}

module.exports = { start, stop, save, state, openFolder, папка }
