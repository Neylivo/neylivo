// Значок приложения из присланного логотипа. Запуск:
//   node_modules/.bin/electron scripts/make-icon.cjs <путь к png>
//
// Что делает: обрезает поля, доводит до квадрата, кладёт на белое и пишет
// 512×512 туда, где значок ждут — public/, assets/ приложения и assets/ сайта.
//
// ПОЧЕМУ БЕЛЫЙ ФОН, А НЕ ПРОЗРАЧНЫЙ. В самом знаке белое — это его часть:
// внутренняя буква и просветы шестиугольника. Сделай белое прозрачным — знак
// превратится в дырявый контур, а на тёмной теме приложения через эти дыры
// полезет фон. Поэтому квадрат остаётся белым; на тёмной подложке он читается
// как обычная светлая плашка, что для значка нормально.
const { app, BrowserWindow, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const ВХОД = process.argv[2]
if (!ВХОД || !fs.existsSync(ВХОД)) {
  console.error('нужен путь к картинке: electron scripts/make-icon.cjs <файл.png>')
  process.exit(1)
}

const КОРЕНЬ = path.join(__dirname, '..')
const САЙТ = path.join(КОРЕНЬ, '..', 'ponoi-site', 'assets')
const РАЗМЕР = 512
const ПОЛЕ = 0.055          // доля поля вокруг знака
const БЕЛОЕ = 246           // ярче этого во всех каналах — считаем фоном

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const исходник = nativeImage.createFromPath(ВХОД)
  const { width: W, height: H } = исходник.getSize()
  const buf = исходник.toBitmap()   // BGRA
  if (!W || !H) { console.error('не прочиталась картинка'); app.exit(1); return }

  // Границы знака: всё, что заметно темнее белого.
  let minx = W, miny = H, maxx = 0, maxy = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    const b = buf[i], g = buf[i + 1], r = buf[i + 2], a = buf[i + 3]
    if (a > 40 && (r < БЕЛОЕ || g < БЕЛОЕ || b < БЕЛОЕ)) {
      if (x < minx) minx = x; if (x > maxx) maxx = x
      if (y < miny) miny = y; if (y > maxy) maxy = y
    }
  }
  if (maxx <= minx || maxy <= miny) { console.error('на картинке не нашлось знака'); app.exit(1); return }

  const ш = maxx - minx + 1, в = maxy - miny + 1
  const сторона = Math.max(ш, в)
  const поле = Math.round(сторона * ПОЛЕ)
  const бок = сторона + поле * 2

  // Рисуем настоящим движком: он же и сглаживает при уменьшении.
  const html = `<!doctype html><meta charset=utf-8>
<style>*{margin:0;padding:0}html,body{width:${РАЗМЕР}px;height:${РАЗМЕР}px;overflow:hidden;background:#fff}
#s{position:relative;width:${РАЗМЕР}px;height:${РАЗМЕР}px;overflow:hidden}
img{position:absolute;image-rendering:auto;
  width:${(W / бок) * РАЗМЕР}px; height:${(H / бок) * РАЗМЕР}px;
  left:${(-(minx - поле) / бок) * РАЗМЕР}px; top:${(-(miny - поле) / бок) * РАЗМЕР}px}</style>
<div id="s"><img src="${'file:///' + path.resolve(ВХОД).split(path.sep).join('/')}"></div>`
  const врем = path.join(require('os').tmpdir(), 'neylivo-icon-' + process.pid + '.html')
  fs.writeFileSync(врем, html)

  const win = new BrowserWindow({ width: РАЗМЕР, height: РАЗМЕР, show: false, useContentSize: true, frame: false })
  await win.loadFile(врем)
  await new Promise(r => setTimeout(r, 700))
  await win.webContents.capturePage()          // первый кадр у скрытого окна отстаёт
  await new Promise(r => setTimeout(r, 400))
  const кадр = await win.webContents.capturePage()
  const png = кадр.resize({ width: РАЗМЕР, height: РАЗМЕР }).toPNG()
  win.destroy()
  fs.unlinkSync(врем)

  const куда = [
    path.join(КОРЕНЬ, 'public', 'icon.png'),
    path.join(КОРЕНЬ, 'assets', 'icon.png'),
    path.join(КОРЕНЬ, 'assets', 'splash.png'),
    path.join(САЙТ, 'icon.png'),
  ]
  for (const f of куда) {
    if (!fs.existsSync(path.dirname(f))) continue
    fs.writeFileSync(f, png)
    console.log('записан: ' + f + ' (' + (png.length / 1024).toFixed(0) + ' КБ)')
  }
  console.log('обрезано по знаку: ' + ш + '×' + в + ' из ' + W + '×' + H)
  app.exit(0)
})
