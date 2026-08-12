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

/** Куда складывать клипы. По умолчанию — «Видео/NeyLivo», как делает Medal. */
function папка() {
  if (настройки.folder) return настройки.folder
  let база
  try { база = app.getPath('videos') } catch { база = app.getPath('home') }
  return path.join(база, 'NeyLivo')
}

function страница() {
  // Вся работа с камерой экрана живёт здесь: в главном процессе нет ни
  // MediaRecorder, ни доступа к потоку.
  return `<!doctype html><meta charset=utf-8><body><script>
const { ipcRenderer } = require('electron')
const fs = require('fs')
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

ipcRenderer.on('сохранить', async (_e, { seconds, id, файл }) => {
  try {
    const порог = Date.now() - seconds * 1000
    const взять = кусочки.filter(c => c.head || c.at >= порог)
    if (взять.length < 2) { ipcRenderer.send('клип', { id, ok: false, why: 'пока нечего сохранять' }); return }
    const blob = new Blob(взять.map(c => c.blob), { type: 'video/webm' })
    // Пишем файл ЗДЕСЬ, а не пересылаем его главному процессу.
    //
    // Сперва клип уходил как Array.from(uint8) — обычным массивом чисел. На
    // тридцати секундах это тринадцать миллионов элементов: приложение выживало,
    // но памяти прибавлялось сразу полтораста мегабайт на тринадцать мегабайт
    // видео. На трёх минутах в качестве «Чётко» это уже под двести мегабайт
    // видео и массив на двести миллионов чисел — приложение просто ложится, и
    // ровно на это владелец пожаловался: «при сохранении клипа приложение
    // ломается».
    //
    // Здесь есть fs (окно с nodeIntegration), и байты уже лежат рядом. Через
    // границу процессов уходит только путь.
    const буфер = Buffer.from(await blob.arrayBuffer())
    fs.writeFileSync(файл, буфер)
    ipcRenderer.send('клип', { id, ok: true, path: файл, bytes: буфер.length })
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
  const дир = папка()
  try { fs.mkdirSync(дир, { recursive: true }) } catch { /* уже есть */ }
  // Имя занято — берём соседнее, а не пишем поверх.
  //
  // В имени время с точностью до секунды, и два нажатия в одну секунду дали бы
  // один файл: человек нажал дважды, а клип остался один, причём молча.
  let файл = path.join(дир, name)
  if (fs.existsSync(файл)) {
    const без = String(name).replace(/\.webm$/i, '')
    for (let n = 2; n < 100; n++) {
      const п = path.join(дир, без + ' (' + n + ').webm')
      if (!fs.existsSync(п)) { файл = п; break }
    }
  }
  const id = Math.random().toString(36).slice(2)
  // Путь считается ЗДЕСЬ, а пишет файл окно записи: у него байты уже в руках, и
  // через границу процессов не идёт ничего, кроме строки.
  //
  // Ждём дольше прежнего: три минуты в качестве «Чётко» — это под двести
  // мегабайт, и на медленном диске пятнадцати секунд может не хватить. Отказ по
  // времени тут хуже ожидания: клип уже записан, человек его просто не получит.
  return await new Promise(готово => {
    const слушать = (_e, r) => { if (r.id === id) { ipcMain.off('клип', слушать); готово(r) } }
    ipcMain.on('клип', слушать)
    окно.webContents.send('сохранить', { seconds, id, файл })
    setTimeout(() => { ipcMain.off('клип', слушать); готово({ ok: false, why: 'не дождались клипа' }) }, 60000)
  })
}

/**
 * v1.539.0: сохранение по горячей клавише.
 *
 * Живёт здесь, а не в main.cjs, чтобы этот путь можно было проверить целиком
 * (npm run test:clip). Настройки присылает окно; имя файла собирается ЗДЕСЬ, в
 * момент нажатия — присланное заранее готовое имя означало бы, что второе
 * нажатие затирает первый клип.
 */
let горячие = { seconds: 30, game: '' }
function hotkeySettings(o) { горячие = { ...горячие, ...(o || {}) }; return { ok: true } }
function saveHotkey() { return save(горячие.seconds || 30, имяКлипа(new Date(), горячие.game)) }

function state() {
  return { running: идёт, folder: папка(), ...настройки }
}

/** Показать папку с клипами в проводнике. */
function openFolder() {
  const дир = папка()
  try { fs.mkdirSync(дир, { recursive: true }) } catch { /* уже есть */ }
  shell.openPath(дир)
}

/**
 * v1.539.0: список записанных клипов.
 *
 * Читается прямо из папки, а не из своей памяти: клипы туда мог положить и
 * прошлый запуск приложения, и человек мог что-то удалить руками. Список,
 * который помнит удалённое, врёт при первом же открытии проводника.
 */
function list() {
  const дир = папка()
  let имена = []
  try { имена = fs.readdirSync(дир) } catch { return [] }
  const из = []
  for (const имя of имена) {
    if (!/\.webm$/i.test(имя)) continue
    try {
      const st = fs.statSync(path.join(дир, имя))
      из.push({ name: имя, path: path.join(дир, имя), bytes: st.size, at: st.mtimeMs })
    } catch { /* исчез между чтением и проверкой — бывает */ }
  }
  return из.sort((a, b) => b.at - a.at)
}

/** Показать клип в проводнике — с выделением самого файла. */
function reveal(name) {
  const файл = path.join(папка(), path.basename(String(name || '')))
  if (!fs.existsSync(файл)) return { ok: false, why: 'файла больше нет' }
  shell.showItemInFolder(файл)
  return { ok: true }
}

/** Удалить клип. Имя берём только последней частью пути: снаружи может прийти что угодно. */
function remove(name) {
  const файл = path.join(папка(), path.basename(String(name || '')))
  try { fs.unlinkSync(файл); return { ok: true } }
  catch (e) { return { ok: false, why: String((e && e.message) || e) } }
}

/**
 * Имя файла клипа — то же, что у кнопки в настройках (src/lib/clipBuffer.ts).
 *
 * Живёт здесь, а не в main.cjs, ровно потому что его надо проверять: клип по
 * горячей клавише обязан получать время НАЖАТИЯ. Сперва готовое имя присылало
 * окно вместе с настройками — и каждое следующее нажатие F7 писало файл с тем
 * же именем, молча затирая предыдущий клип.
 */
function имяКлипа(когда, игра) {
  const дв = n => String(n).padStart(2, '0')
  const дата = когда.getFullYear() + '-' + дв(когда.getMonth() + 1) + '-' + дв(когда.getDate())
  const время = дв(когда.getHours()) + '-' + дв(когда.getMinutes()) + '-' + дв(когда.getSeconds())
  // Тот же набор запретных знаков, что и в clipBuffer.ts: управляющие символы и
  // то, что Windows не пускает в имя файла. Дефисы и пробелы остаются — иначе
  // «Half-Life 2» становится «HalfLife2».
  const и = String(игра || '').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40).trim()
  return (и ? и + ' ' : '') + дата + ' ' + время + '.webm'
}

module.exports = {
  start, stop, save, state, openFolder, папка, list, reveal, remove,
  имяКлипа, hotkeySettings, saveHotkey,
}
